import { appendMessage, assistantReplyCount, deriveTitle, markQuestionUsed, renameSession } from '../engine/chat.js';
import { applyRestState, drawQuestion, planInjection } from '../engine/questions.js';
import { compileChatRequest } from '../engine/prompt.js';
import { RetryableError } from '../engine/judge.js';
import { callText } from '../gateway/model.js';
import { describeRequest, recordRequest } from './request-record.js';

export function prepareUserTurn(session, text, { chooseQuestion = drawQuestion } = {}) {
  if (session.messages.at(-1)?.role === 'user') {
    throw new RetryableError('上一条消息还没有回复，请重新生成或删除后再发送', { kind: 'pending-reply' });
  }
  const value = String(text ?? '').trim();
  if (!value) throw new RetryableError('先说点什么吧', { kind: 'empty-input' });
  const plan = planInjection({ assistantReplyCount: assistantReplyCount(session), everyN: session.everyN, session });
  const question = plan.inject ? chooseQuestion({ session, difficulty: session.difficulty }) : null;
  let next = appendMessage(applyRestState(session, plan.next), { role: 'user', text: value, questionId: question?.id });
  if (question) next = markQuestionUsed(next, question.id);
  return renameSession(next, deriveTitle(next));
}

export function replyAppliesTo(current, snapshot) {
  return current?.id === snapshot?.id
    && current?.messages?.at(-1)?.id === snapshot?.messages?.at(-1)?.id
    && current?.messages?.at(-1)?.role === 'user';
}

export async function generateChatTurn(snapshot, system, profile, { request = callText, signal } = {}) {
  const compiled = compileChatRequest(snapshot, system);
  const requestInfo = describeRequest(compiled, profile, snapshot.lastRequest);
  const started = Date.now();
  try {
    const result = await request({ ...profile, maxOutputTokens: compiled.maxOutputTokens }, {
      messages: compiled.messages,
      signal,
      requestContext: { sessionId: snapshot.id, promptVersion: compiled.promptVersion },
    });
    let next = recordRequest(compiled.session || snapshot, {
      at: started, durationMs: Date.now() - started, status: 'success',
      request: requestInfo, provider: result.request?.provider || profile.provider,
      usage: result.usage,
    });
    next = appendMessage(next, { role: 'assistant', text: result.text, usage: result.usage });
    return next;
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    error.requestRecord = {
      at: started, durationMs: Date.now() - started, status: 'failed', kind: error.kind,
      request: requestInfo, provider: error.request?.provider || profile.provider,
      usage: error.usage,
    };
    throw error;
  }
}

export function retainBodiesAfterSaveFailure(snapshot, generated) {
  const reply = generated.messages.at(-1);
  return {
    ...snapshot,
    messages: [...snapshot.messages, reply],
    updatedAt: generated.updatedAt,
    requestLog: generated.requestLog,
    lastRequest: generated.lastRequest,
  };
}
