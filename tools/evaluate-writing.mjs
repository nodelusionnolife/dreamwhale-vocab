import fs from 'node:fs';
import { LEARNING_QUESTIONS } from '../src/content/learning-bank.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../content-sources/writing-evaluation.json', import.meta.url), 'utf8'));
const questions = new Map(LEARNING_QUESTIONS.map(q => [q.id, q]));
if (!process.argv[2]) {
  console.log(JSON.stringify(fixture.cases.map(c => {
    const q = questions.get(c.questionId);
    if (!q || q.grading !== 'semantic') throw new Error(`Unknown expression task: ${c.questionId}`);
    return { id: c.id, question: q.stem, rubric: q.rubric, reference: q.answer, submission: c.submission };
  }), null, 2));
} else {
  const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (!Array.isArray(results)) throw new Error('Expected an array of { id, status } results.');
  const seen = new Set();
  for (const r of results) {
    if (seen.has(r.id) || !fixture.cases.some(c => c.id === r.id) || !['correct', 'incorrect', 'uncertain'].includes(r.status)) throw new Error('Unknown, duplicate or invalid result.');
    seen.add(r.id);
  }
  const report = fixture.cases.map(c => ({ id: c.id, expected: c.expected, actual: results.find(r => r.id === c.id)?.status || 'missing', reason: c.reason }));
  console.log(JSON.stringify({ total: report.length, matched: report.filter(r => r.actual === r.expected).length, uncertain: report.filter(r => r.actual === 'uncertain').length, cases: report }, null, 2));
  if (report.some(r => r.actual !== r.expected)) process.exitCode = 1;
}
