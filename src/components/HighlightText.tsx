import React from 'react';

interface HighlightTextProps {
  text: string;
  concept?: string;
  isDarkMode?: boolean;
}

export const HighlightText: React.FC<HighlightTextProps> = ({ text, concept, isDarkMode }) => {
  if (text === undefined || text === null) return null;
  const processedText = String(text).replace(/(^|\s+)([0-9٠-٩]{1,2}\s*[-ـ\)])/g, '\n$2');
  const continents = ['آسيا', 'أوروبا', 'إفريقيا', 'أمريكا الشمالية', 'أمريكا الجنوبية', 'أستراليا', 'القارة القطبية'];
  const countries = ['مصر', 'الشام', 'العراق', 'فلسطين', 'سوريا', 'السعودية', 'اليمن', 'عمان', 'المغرب', 'الجزائر', 'تونس', 'ليبيا', 'السودان', 'الصومال', 'جيبوتي', 'موريتانيا'];
  const other_entities = ['الوطن العربي', 'الإسلامي', 'الطولونية', 'الإخشيدية', 'الفاطمية', 'الأيوبية', 'المملوكية', 'العثماني', 'الفرنسية', 'صلاح الدين', 'عمر بن الخطاب', 'الأموي', 'العباسي', 'الفارسي', 'الرومي', 'البيزنطي', 'المحيط الهندي', 'المحيط الأطلنطي', 'البحر الأحمر', 'البحر المتوسط'];
  const keywords = ['أولى', 'الأولى', 'أول', 'الأول', 'ثاني', 'الثاني', 'ثانية', 'الثانية', 'ثالث', 'الثالث', 'ثالثة', 'الثالثة', 'رابع', 'الرابع', 'رابعة', 'الرابعة', 'خامس', 'الخامس', 'خامسة', 'الالخامسة', 'سادس', 'السادس', 'سادسة', 'السادسة', 'سابع', 'السابع', 'سابعة', 'السابعة', 'ثامن', 'الثامن', 'ثامنة', 'الثامنة', 'تاسع', 'التاسع', 'تاسعة', 'التاسعة', 'عاشر', 'العاشر', 'عاشرة', 'العاشرة', 'أعلى', 'أقل', 'أكثر', 'يختلف', 'تختلف', 'تتشابه', 'أكبر', 'أصغر', 'أهم', 'أطول', 'أقصر', 'أسرع', 'أبطأ', 'شرق', 'غرب', 'شمال', 'جنوب', 'صيفاً', 'شتاءً', 'نادر', 'دائم', 'مؤقت', 'إيجابي', 'سلبي'];
  
  interface ElementChunk {
    type: 'text' | 'concept' | 'quote' | 'parenthesis' | 'manual' | 'numbered_start' | 'number_date' | 'keyword' | 'continent' | 'country' | 'other_entity';
    content: string;
  }

  let elements: ElementChunk[] = [{ type: 'text', content: processedText }];
  
  const processElements = (
    elems: ElementChunk[],
    regex: RegExp,
    type: ElementChunk['type']
  ): ElementChunk[] => {
    const newElems: ElementChunk[] = [];
    elems.forEach(el => {
      if (el.type !== 'text') {
        newElems.push(el);
        return;
      }
      const parts = el.content.split(regex);
      parts.forEach((part, idx) => {
        if (part) {
          newElems.push({ 
            type: idx % 2 === 1 ? type : 'text', 
            content: part 
          });
        }
      });
    });
    return newElems;
  };

  elements = processElements(elements, /((?:["'«”])[^"'»“]+(?:["'»“]))/g, 'quote');
  elements = processElements(elements, /(\([^0-9٠-٩][^)]+\))/g, 'parenthesis');
  elements = processElements(elements, /\*\*(.*?)\*\*/g, 'manual');
  elements = processElements(elements, /([0-9٠-٩]{1,2}\s*[-ـ\)]\s*[^\s]+)/g, 'numbered_start');

  if (concept) {
    const escapedConcept = concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    elements = processElements(elements, new RegExp(`([\\u0600-\\u06FF]*${escapedConcept}[\\u0600-\\u06FF]*)`, 'gi'), 'concept');
  }
  
  elements = processElements(elements, /((?:[0-9٠-٩]+)(?:\s*(?:ق\.م|م|هـ))?)/g, 'number_date');
  elements = processElements(elements, new RegExp(`([\\u0600-\\u06FF]*(?:${keywords.join('|')})[\\u0600-\\u06FF]*)`, 'g'), 'keyword');
  elements = processElements(elements, new RegExp(`([\\u0600-\\u06FF]*(?:${continents.join('|')})[\\u0600-\\u06FF]*)`, 'g'), 'continent');
  elements = processElements(elements, new RegExp(`([\\u0600-\\u06FF]*(?:${countries.join('|')})[\\u0600-\\u06FF]*)`, 'g'), 'country');
  elements = processElements(elements, new RegExp(`([\\u0600-\\u06FF]*(?:${other_entities.join('|')})[\\u0600-\\u06FF]*)`, 'g'), 'other_entity');

  return (
    <>
      {elements.map((el, idx) => {
        if (el.type === 'concept') return <span key={idx} className="text-secondary font-black">{el.content}</span>;
        if (el.type === 'quote') return <span key={idx} className={`${isDarkMode ? 'text-purple-300' : 'text-purple-600'} font-black`}>{el.content}</span>;
        if (el.type === 'parenthesis') return <span key={idx} className={`${isDarkMode ? 'text-blue-300' : 'text-blue-900'} font-black mx-1`}>{el.content}</span>;
        if (el.type === 'manual') return <span key={idx} className={`font-bold ${isDarkMode ? 'text-blue-300' : 'text-blue-600'}`}>{el.content}</span>;
        if (el.type === 'numbered_start') return <span key={idx} className={`${isDarkMode ? 'text-red-400' : 'text-red-600'} font-black mx-1`}>{el.content}</span>;
        
        if (el.type === 'number_date') return <span key={idx} className={`${isDarkMode ? 'text-red-400' : 'text-red-600'} font-black`}>{el.content}</span>;
        if (el.type === 'continent') return <span key={idx} className={`${isDarkMode ? 'text-green-400' : 'text-green-600'} font-black`}>{el.content}</span>;
        if (el.type === 'country') return <span key={idx} className={`${isDarkMode ? 'text-blue-300' : 'text-blue-700'} font-black`}>{el.content}</span>;
        if (el.type === 'keyword') return <span key={idx} className={`${isDarkMode ? 'text-pink-400' : 'text-pink-600'} font-black`}>{el.content}</span>;
        if (el.type === 'other_entity') return <span key={idx} className={`${isDarkMode ? 'text-amber-300' : 'text-gold'} font-black`}>{el.content}</span>;
        
        return <span key={idx} className={`${isDarkMode ? 'text-gray-100' : 'text-gray-800'} whitespace-pre-line`}>{el.content}</span>;
      })}
    </>
  );
};
