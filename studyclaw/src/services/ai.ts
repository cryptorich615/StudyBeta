/**
 * AI Service
 * 
 * Higher-level AI functions using OpenClaw as the backend.
 * These are the education-specific tools.
 */

import { callOpenClaw } from './openclaw.js';

interface Flashcard {
  front: string;
  back: string;
  type: 'BASIC' | 'CLOZE' | 'MULTIPLE_CHOICE';
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

interface StudyBlock {
  day: number;
  topic: string;
  duration: number;
  activities: string[];
}

/**
 * Generate flashcards from text
 */
export async function generateFlashcards(text: string): Promise<Flashcard[]> {
  const systemPrompt = `You are a flashcard generator. Given study material, create 5-10 effective flashcards.

Rules:
- Front should be a clear question
- Back should be the answer
- Include a mix of BASIC and CLOZE cards
- Focus on key concepts and definitions
- Output ONLY valid JSON array like: [{"front":"Q","back":"A","type":"BASIC"}]`;

  const response = await callOpenClaw({
    message: `Create flashcards from this material:\n\n${text}`,
    systemPrompt,
  });

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch {
    console.error('Failed to parse flashcards:', response);
    return [];
  }
}

/**
 * Generate quiz questions
 */
export async function generateQuiz(
  topic: string,
  difficulty: string,
  count: number = 5
): Promise<QuizQuestion[]> {
  const systemPrompt = `You are a quiz generator. Create ${count} multiple choice questions about the topic.

Rules:
- Difficulty: ${difficulty}
- Each question has 4 options (A, B, C, D)
- One correct answer
- Brief explanation for why it's correct
- Output ONLY valid JSON array like: [{"question":"","options":["","","",""],"correctAnswer":0,"explanation":""}]`;

  const response = await callOpenClaw({
    message: `Generate quiz on: ${topic}`,
    systemPrompt,
  });

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch {
    console.error('Failed to parse quiz:', response);
    return [];
  }
}

/**
 * Explain a concept at appropriate level
 */
export async function explainConcept(topic: string, level: string): Promise<string> {
  const systemPrompt = `You are a patient tutor. Explain concepts clearly at ${level} level.

Rules:
- Start with a brief overview
- Use analogies when helpful
- Give concrete examples
- Check understanding with a question at the end
- Be encouraging and supportive`;

  const response = await callOpenClaw({
    message: `Explain: ${topic}`,
    systemPrompt,
  });

  return response;
}

/**
 * Generate study plan
 */
export async function generateStudyPlan(
  topic: string,
  daysUntilTest: number,
  hoursPerDay: number
): Promise<StudyBlock[]> {
  const systemPrompt = `You are a study planner. Create a structured study plan.

Rules:
- Divide the topic into logical sections
- Spread review over the days available
- Include variety: reading, practice, review
- Allocate time realistically
- Output ONLY valid JSON array like: [{"day":1,"topic":"","duration":60,"activities":[]}]`;

  const response = await callOpenClaw({
    message: `Create ${daysUntilTest}-day study plan for: ${topic}. Student has ${hoursPerDay} hours per day.`,
    systemPrompt,
  });

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch {
    console.error('Failed to parse study plan:', response);
    return [];
  }
}
