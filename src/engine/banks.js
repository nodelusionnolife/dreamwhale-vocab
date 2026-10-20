import { CET6_WORDS } from '../content/cet6-words.js';
import { FREQUENCY_EVIDENCE } from '../content/frequency.js';

export const BANKS = { cet4: '四级', cet6: '六级', mixed: '混合' };
export const FREQUENCIES = { all: '全部', high: '高频' };
const sharedSpellings = new Set(['appropriate', 'converse', 'invalid', 'staple']);
const advancedWords = new Set(CET6_WORDS.filter(w => !sharedSpellings.has(w.word)).flatMap(w => w.accepts.map(form => form.toLowerCase())));

export function questionBank(question) {
  if (question?.bank === 'cet4' || question?.bank === 'cet6') return question.bank;
  return advancedWords.has(String(question?.targetWords?.[0] || question?.answer || '').toLowerCase()) ? 'cet6' : 'cet4';
}

export function frequencySources(question) {
  const word = String(question?.targetWords?.[0] || question?.answer || '').toLowerCase();
  return FREQUENCY_EVIDENCE[questionBank(question)][word] || [];
}

export function matchesBank(question, bank = 'cet4', frequency = 'all') {
  return (bank === 'mixed' || questionBank(question) === bank)
    && (frequency === 'all' || frequency === 'high' && frequencySources(question).length >= 2);
}
