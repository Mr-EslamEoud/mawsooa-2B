import { Unit, Lesson, Question } from "./types";
import { simpleHash } from "./utils";

export interface FlatQuestionRow {
  unit?: string;
  section?: string;
  audio?: string;
  video?: string;
  opt1?: string;
  opt2?: string;
  opt3?: string;
  opt4?: string;
  type?: string;
  q: string;
  correct: string;
  reason: string;
  concept: string;
  paragraph: string;
}

export const buildCourseData = (flatQuestions: FlatQuestionRow[]): Unit[] => {
  const course: Unit[] = [];
  let completedLessons: string[] = [];
  try {
    completedLessons = JSON.parse(localStorage.getItem('completedLessons') || '[]');
  } catch(e) {}
  
  flatQuestions.forEach(row => {
    const unitTitle = row.unit || "وحدة عامة";
    const lessonTitle = row.section || "درس عام";
    
    let unit = course.find(u => u.title === unitTitle);
    if (!unit) {
      unit = { id: `unit_${simpleHash(unitTitle)}`, title: unitTitle, lessons: [] };
      course.push(unit);
    }
    
    const lessonId = `lesson_${simpleHash(unitTitle + lessonTitle)}`;
    let lesson = unit.lessons.find((l): l is Lesson => l.title === lessonTitle);
    
    if (!lesson) {
      lesson = { 
        id: lessonId, 
        title: lessonTitle, 
        questions: [], 
        completed: completedLessons.includes(lessonId), 
        audio: null, 
        video: null 
      };
      unit.lessons.push(lesson);
    }
    
    if (!lesson.audio && row.audio && row.audio.toString().trim() !== "") {
      lesson.audio = row.audio.toString().trim();
    }
    if (!lesson.video && row.video && row.video.toString().trim() !== "") {
      lesson.video = row.video.toString().trim();
    }

    const options = [row.opt1, row.opt2, row.opt3, row.opt4].filter((o): o is string => !!o && o.toString().trim() !== "");
    
    let determinedType = (row.type || "").toString().trim().toLowerCase();
    if (!determinedType) {
      determinedType = options.length > 0 ? "mcq" : "essay";
    }

    const question: Question = {
      type: determinedType,
      q: row.q,
      options: options,
      correct: row.correct ? row.correct.toString().trim() : "",
      reason: row.reason ? row.reason.toString().trim() : "",
      answer: row.reason ? row.reason.toString().trim() : "",
      concept: row.concept ? row.concept.toString().trim() : "",
      paragraph: row.paragraph ? row.paragraph.toString().trim() : "",
      section: lessonTitle
    };

    lesson.questions.push(question);
  });
  
  return course;
};
