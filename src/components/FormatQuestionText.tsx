import React from 'react';
import { HighlightText } from './HighlightText';

interface FormatQuestionTextProps {
  text: string;
  concept?: string;
  isDarkMode?: boolean;
}

export const FormatQuestionText: React.FC<FormatQuestionTextProps> = ({ text, concept, isDarkMode }) => {
  if (text === undefined || text === null) return null;
  const processedText = String(text).replace(/(^|\s+)([0-9٠-٩]{1,2}\s*[-ـ\)])/g, '\n$2');
  
  let starterSpan: React.ReactNode = null;
  let remainingText = processedText;

  const tfRegex = /^(حدد صحة او خطأ العبارة التالية|حدد صحة أو خطأ العبارة التالية|حدد صحة او خطأ العبارة|حدد صحة أو خطأ العبارة|حدد صحة أو خطأ|صح أم خطأ|ضع علامة صح أو خطأ|اكتب كلمة صواب أو خطأ|هل العبارة صحيحة أم خطأ|هل العبارة صحيحة ام خاطئة مع التعليل|بالادلة حدد مدي صحة او خطأ العبارة|حدد مدى صحة أو خطأ العبارة)\s*[:؟\?\-]?\s*/i;
  const standardRegex = /^(بم تفسر|بما تفسر|ما النتائج المترتبة على|ما النتائج|دلل|أيد بالدليل|أيد|ماذا يحدث إذا|ماذا يحدث لو|قارن|ما العلاقة|اكتب المفهوم|اكتب ما تشير إليه|اكتب ما تشير|ما رأيك|ما مقترحات|ما مقترحاتك|حدد)\s*[:؟\?\-]?\s*/i;

  let match = processedText.match(tfRegex);
  if (match) {
    starterSpan = <span key="starter" className={`${isDarkMode ? 'text-indigo-400' : 'text-indigo-700'} font-black ml-2 text-2xl drop-shadow-sm`}>{match[0]}</span>;
    remainingText = processedText.substring(match[0].length);
  } else {
    match = processedText.match(standardRegex);
    if (match) {
      starterSpan = <span key="starter" className={`${isDarkMode ? 'text-red-400' : 'text-red-800'} font-black ml-2 text-2xl`}>{match[0]}</span>;
      remainingText = processedText.substring(match[0].length);
    } else {
      const colonMatch = processedText.match(/^([^:]{1,45}[:])\s*/);
      if (colonMatch) {
        starterSpan = <span key="starter" className={`${isDarkMode ? 'text-red-400' : 'text-red-800'} font-black ml-2 text-2xl`}>{colonMatch[0]}</span>;
        remainingText = processedText.substring(colonMatch[0].length);
      }
    }
  }

  return (
    <React.Fragment>
      {starterSpan}
      <HighlightText text={remainingText} concept={concept} isDarkMode={isDarkMode} />
    </React.Fragment>
  );
};
