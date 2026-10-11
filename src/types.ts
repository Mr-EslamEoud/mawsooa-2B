export interface Question {
  type: string;
  q: string;
  options: string[];
  correct: string;
  reason: string;
  answer: string;
  concept: string;
  paragraph: string;
  section: string;
}

export interface Lesson {
  id: string;
  title: string;
  questions: Question[];
  completed: boolean;
  audio?: string | null;
  video?: string | null;
}

export interface Unit {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface Student {
  name: string;
  code?: string;
  isPaid?: boolean;
  missingMonths?: string[];
  graceMonths?: string[];
  graceDaysRemaining?: number;
  phone?: string;
  role?: string;
  passHash?: string;
}

export interface UserAnswer {
  isCorrect: boolean;
  selected?: string;
  concept: string;
  paragraph: string;
  type: string;
}

export interface PendingRequest {
  date: string;
  name: string;
  phone: string;
  method: string;
}

export interface TestResult {
  name: string;
  phone: string;
  quiz: string;
  score: string;
  date: string;
}

export interface GroupedResult {
  name: string;
  phone: string;
  tests: TestResult[];
}

export interface InteractiveMap {
  id: string | number;
  title: string;
  url: string;
}
