const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'been', 'before', 'being', 'between',
  'both', 'could', 'does', 'during', 'each', 'from', 'have', 'into', 'just', 'more', 'most', 'notes',
  'other', 'over', 'same', 'some', 'such', 'than', 'that', 'their', 'them', 'there', 'these', 'this',
  'those', 'through', 'today', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'para', 'chapter', 'course', 'contents'
]);

type StudyFact = {
  text: string;
  keyword: string;
};

export function buildFallbackFlashcards(input: { title: string; text: string; desiredCount?: number }) {
  const facts = extractStudyFacts(input.text);
  const desiredCount = clamp(input.desiredCount ?? 8, 4, 10);
  if (!facts.length) {
    return [];
  }

  const cards: { front: string; back: string }[] = [];
  for (let index = 0; index < desiredCount; index += 1) {
    const fact = facts[index % facts.length];
    if (index % 2 === 0) {
      cards.push({
        front: `What should you remember about ${fact.keyword}?`,
        back: fact.text,
      });
      continue;
    }

    const clue = blankKeyword(fact.text, fact.keyword);
    cards.push({
      front: `Which term fits this clue?\n\n${clue}`,
      back: fact.keyword,
    });
  }

  return dedupeFlashcards(cards).slice(0, desiredCount);
}

export function buildFallbackQuiz(input: { title: string; text: string; questionCount: number }) {
  const facts = extractStudyFacts(input.text);
  const desiredCount = clamp(input.questionCount, 3, 12);
  if (!facts.length) {
    return [];
  }

  const keywordPool = Array.from(new Set(facts.map((fact) => fact.keyword).filter(Boolean)));
  const questions: {
    question_text: string;
    question_type: string;
    choices: string[];
    answer: { correct: string };
    explanation: string;
  }[] = [];

  for (let index = 0; index < desiredCount; index += 1) {
    const fact = facts[index % facts.length];
    if (index % 2 === 0) {
      const choices = buildMultipleChoiceOptions(fact.keyword, keywordPool);
      questions.push({
        question_text: `Which term best matches this clue?\n\n${blankKeyword(fact.text, fact.keyword)}`,
        question_type: 'multiple_choice',
        choices,
        answer: { correct: fact.keyword },
        explanation: fact.text,
      });
      continue;
    }

    questions.push({
      question_text: blankKeyword(fact.text, fact.keyword),
      question_type: 'fill_in_the_blank',
      choices: [],
      answer: { correct: fact.keyword },
      explanation: fact.text,
    });
  }

  return questions.slice(0, desiredCount);
}

function extractStudyFacts(text: string) {
  const cleaned = String(text ?? '')
    .replace(/\[Source text truncated for study generation\.\]/g, ' ')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return [] as StudyFact[];
  }

  const fragments = cleaned
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 30 && fragment.length <= 240)
    .filter((fragment) => /[a-z]/i.test(fragment))
    .filter((fragment) => !/^(contents|chapter|page|\d+)$/i.test(fragment));

  const facts: StudyFact[] = [];
  const seen = new Set<string>();

  for (const fragment of fragments) {
    const normalized = fragment.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    const keyword = extractKeyword(fragment);
    if (!keyword) {
      continue;
    }

    facts.push({
      text: fragment,
      keyword,
    });
  }

  return facts.slice(0, 18);
}

function extractKeyword(sentence: string) {
  const words = sentence.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{3,}/g) ?? [];
  for (const rawWord of words) {
    const normalized = rawWord.toLowerCase();
    if (STOP_WORDS.has(normalized)) {
      continue;
    }

    return rawWord.replace(/[.,;:!?]+$/g, '');
  }

  return '';
}

function blankKeyword(sentence: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaced = sentence.replace(new RegExp(`\\b${escaped}\\b`, 'i'), '_____');
  return replaced === sentence ? `${sentence}\n\nKey term: _____` : replaced;
}

function buildMultipleChoiceOptions(correct: string, pool: string[]) {
  const distractors = pool
    .filter((value) => value.toLowerCase() !== correct.toLowerCase())
    .slice(0, 6);
  const options = Array.from(new Set([correct, ...distractors])).slice(0, 4);

  while (options.length < 4) {
    options.push(`Option ${options.length + 1}`);
  }

  return shuffle(options);
}

function dedupeFlashcards(cards: { front: string; back: string }[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = `${card.front}::${card.back}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function shuffle<T>(values: T[]) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = index % 2 === 0 ? Math.floor(index / 2) : Math.floor((index - 1) / 2);
    const current = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = current;
  }
  return copy;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}
