'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'quizzes.json');
const SAMPLES = path.join(__dirname, '..', 'sample-quizzes.json');

const rid = () => crypto.randomBytes(6).toString('hex');
const str = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const IMAGE_RE = /^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/;

function sanitizeQuestion(q, n) {
  const where = `Question ${n}`;
  const type = q.type === 'truefalse' ? 'truefalse' : 'quiz';
  const text = str(q.text, 200);
  if (!text) throw new Error(`${where} needs some question text.`);

  let answers = (Array.isArray(q.answers) ? q.answers : []).slice(0, 4)
    .map(a => ({ text: str(a?.text, 90), correct: !!a?.correct }));
  if (type === 'truefalse') {
    const trueIsCorrect = answers[0]?.correct || !answers[1]?.correct;
    answers = [{ text: 'True', correct: trueIsCorrect }, { text: 'False', correct: !trueIsCorrect }];
  } else {
    answers = answers.filter(a => a.text);
    if (answers.length < 2) throw new Error(`${where} needs at least 2 answers.`);
    if (!answers.some(a => a.correct)) throw new Error(`${where} needs a correct answer.`);
  }

  const image = typeof q.image === 'string' && IMAGE_RE.test(q.image) && q.image.length < 4e6 ? q.image : '';
  const timeLimit = Math.min(240, Math.max(5, Math.round(Number(q.timeLimit) || 20)));
  const points = [0, 1, 2].includes(Number(q.points)) ? Number(q.points) : 1;
  return { id: typeof q.id === 'string' && q.id ? q.id.slice(0, 32) : rid(), type, text, image, timeLimit, points, answers };
}

function sanitize(input, id) {
  const title = str(input?.title, 80);
  if (!title) throw new Error('Your quiz needs a title.');
  const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 100).map((q, i) => sanitizeQuestion(q || {}, i + 1));
  if (!questions.length) throw new Error('Add at least one question.');
  return {
    id: id || rid(),
    title,
    description: str(input.description, 160),
    emoji: Array.from(str(input.emoji, 16) || '🦉').slice(0, 4).join(''),
    questions,
    updatedAt: Date.now(),
  };
}

function persist(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const seeded = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')).map(q => sanitize(q));
    persist(seeded);
    return seeded;
  }
}

let quizzes = load();

module.exports = {
  list: () => quizzes,
  get: id => quizzes.find(q => q.id === id),
  create(input) {
    const quiz = sanitize(input);
    quizzes = [quiz, ...quizzes];
    persist(quizzes);
    return quiz;
  },
  update(id, input) {
    if (!quizzes.some(q => q.id === id)) return null;
    const quiz = sanitize(input, id);
    quizzes = quizzes.map(q => (q.id === id ? quiz : q));
    persist(quizzes);
    return quiz;
  },
  remove(id) {
    quizzes = quizzes.filter(q => q.id !== id);
    persist(quizzes);
  },
};
