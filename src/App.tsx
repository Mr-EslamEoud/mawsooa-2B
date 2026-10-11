import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Unit, 
  Lesson, 
  Question, 
  Student, 
  UserAnswer, 
  PendingRequest, 
  GroupedResult, 
  InteractiveMap,
  TestResult
} from './types';
import { 
  API_URL, 
  SECRET_API_KEY, 
  BASE_STUDENTS, 
  PAYMENT_INFO,
  subjectName, 
  gradeName, 
  simpleHash, 
  toEasternArabic, 
  formatPhoneStr, 
  generateDeviceFingerprint, 
  getDirectAudioLink, 
  getYoutubeEmbedLink 
} from './utils';
import { buildCourseData, FlatQuestionRow } from './courseBuilder';
import { HighlightText } from './components/HighlightText';
import { FormatQuestionText } from './components/FormatQuestionText';
import { DrawingCanvas } from './components/DrawingCanvas';
import { usePWA } from './usePWA';

// دالة مخصصة لمعالجة الدرجات المحولة إلى أرقام عشرية بواسطة جوجل شيتس (مثل 0.98 أو 1)
const normalizeScore = (scoreRaw: string | number): number => {
  if (scoreRaw === undefined || scoreRaw === null) return 0;
  if (typeof scoreRaw === 'number') {
    if (scoreRaw > 0 && scoreRaw <= 1) return Math.round(scoreRaw * 100);
    return Math.round(scoreRaw);
  }
  const str = String(scoreRaw).trim();
  if (str.includes('تصفير')) return 0;
  
  let val = parseFloat(str.replace(/%|٪/g, '').trim());
  if (isNaN(val)) return 0;
  
  if (!str.includes('%') && !str.includes('٪') && val > 0 && val <= 1) {
    return Math.round(val * 100);
  }
  return Math.round(val);
};

const normalizeLessonName = (s: string) => {
    if (!s) return '';
    return s.replace(/[أإآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\u0600-\u06FF0-9a-zA-Z]/g, '');
};

const getCoreWords = (s: string) => s.split(/[\s:،-]+/).map(w => normalizeLessonName(w)).filter(w => w.length > 2 && !['درس', 'وحده', 'علي', 'الي', 'عن', 'مراجعة', 'مراجعه', 'عامة', 'عامه', 'شاملة', 'شامله', 'تدريبات', 'اختبار', 'امتحان'].includes(w));

const matchQuizToCurrent = (q: string, validLessons: string[]) => {
    const normQ = normalizeLessonName(q);
    const exact = validLessons.find(t => normalizeLessonName(t) === normQ);
    if (exact) return exact;

    const reqKeywords = ['زراع', 'رع', 'تعدين', 'صناع', 'يولي', 'فلسطين', 'كتوبر', 'صراع', 'يناير'];

    const qWords = getCoreWords(q);
    let bestMatch = '';
    let maxScore = 0;
    
    for (const t of validLessons) {
        const tWords = getCoreWords(t);
        const overlap = qWords.filter(qw => tWords.includes(qw)).length;
        
        let score = overlap * 2;
        
        for (const kw of reqKeywords) {
            const normKw = normalizeLessonName(kw);
            if (normQ.includes(normKw) && normalizeLessonName(t).includes(normKw)) {
                score += 5;
            }
        }
        
        if (normalizeLessonName(t).includes(normQ) || normQ.includes(normalizeLessonName(t))) {
            score += 10;
        }

        if (score > maxScore && score >= 3) {
            maxScore = score;
            bestMatch = t;
        }
    }
    return bestMatch || null;
};

// دالة للتعرف على المسميات القديمة والعامة لتجاهلها وإجبار الطلاب على إعادة حلها بالمسمى الجديد
const isAmbiguousOldQuiz = (qRaw: string | number): boolean => {
  if (!qRaw) return false;
  const q = normalizeLessonName(String(qRaw));
  const ambiguous = [
    'وحدة عامة',
    'درس عام',
    'المراجعة العامة للوحدة',
    'المراجعة العامة',
    'المراجعة العامة على الوحدة',
    'المراجعة العامة علي الوحدة',
    'المراجعة الشاملة',
    'المراجعة الشاملة للوحدة',
    'المراجعة الشاملة على الوحدة',
    'تدريبات علي الوحدة',
    'تدريبات على الوحدة',
    'تدريبات الوحدة',
    'مراجعة الوحدة',
    'اختبار الوحدة',
    'امتحان الوحدة',
    'امتحان شامل',
    'امتحان شامل على الوحدة',
    'امتحان شامل للوحدة'
  ].map(normalizeLessonName);
  return ambiguous.includes(q);
};

// دوال لخلط الأسئلة والإجابات بطريقة عشوائية
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

const shuffleOptions = (options: string[]): string[] => {
  const shuffled = shuffleArray(options);
  const keepAtEnd = ['كل ما سبق', 'جميع ما سبق', 'لا شيء مما سبق', 'أ و ب', 'ا و ب', 'أ و ج', 'ا و ج', 'ب و ج', 'الأولى والثانية', 'الاولى والثانية', 'الأولى والثالثة', 'الاولى والثالثة', 'الثانية والثالثة', 'مما سبق', 'معاً', 'معا'];
  return shuffled.sort((a, b) => {
    const aIsEnd = keepAtEnd.some(phrase => a.includes(phrase));
    const bIsEnd = keepAtEnd.some(phrase => b.includes(phrase));
    if (aIsEnd && !bIsEnd) return 1;
    if (!aIsEnd && bIsEnd) return -1;
    return 0;
  });
};

export default function App() {
  const [screen, setScreen] = useState<string>('home');
  const [studentName, setStudentName] = useState<string>('');
  const [inputPhone, setInputPhone] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timerMode, setTimerMode] = useState<string>(() => localStorage.getItem('timerMode') || 'custom_units');
  const [timerUnitTargets, setTimerUnitTargets] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('timerUnitTargets');
      if (saved) return JSON.parse(saved);
      const oldSaved = localStorage.getItem('timerUnitTarget');
      if (oldSaved) return [oldSaved];
    } catch(e) {}
    return [];
  });
  const [timerSecondsPerQ, setTimerSecondsPerQ] = useState<number>(() => {
    const saved = localStorage.getItem('timerSecondsPerQ');
    return saved ? Number(saved) : 60;
  });
  const [publishedLessons, setPublishedLessons] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('publishedLessons');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [];
  });
  const [isSavingLessons, setIsSavingLessons] = useState<boolean>(false);
  const [showPasswordInput, setShowPasswordInput] = useState<boolean>(false);
  const [inputPassword, setInputPassword] = useState<string>('');
  const [selectedTwin, setSelectedTwin] = useState<Student | null>(null);
  
  const [showRegisterModal, setShowRegisterModal] = useState<boolean>(false);
  const [showWelcomeSubscribeModal, setShowWelcomeSubscribeModal] = useState<boolean>(false);
  const [registerName, setRegisterName] = useState<string>('');
  const [registerMethod, setRegisterNameMethod] = useState<string>('');
  
  const [platformFee, setPlatformFee] = useState<string>(PAYMENT_INFO.fee);
  const [newFeeInput, setNewFeeInput] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');
  const [studentData, setStudentData] = useState<Student | null>(null);
  
  const [showUnpaidModal, setShowUnpaidModal] = useState<boolean>(false);
  const [unpaidPaymentMethod, setUnpaidPaymentMethod] = useState<string>('');
  const [showGraceModal, setShowGraceModal] = useState<boolean>(false);
  const [pendingGraceLogin, setPendingGraceLogin] = useState<(() => Promise<void>) | null>(null);
  
  const [adminResults, setAdminResults] = useState<GroupedResult[]>([]);
  const [adminPendingReqs, setAdminPendingReqs] = useState<PendingRequest[]>([]);
  const [selectedActivationReq, setSelectedActivationReq] = useState<PendingRequest | null>(null);
  const [activationPackage, setActivationPackage] = useState<'شهري' | 'ترم أول' | 'ترم ثانٍ' | 'سنة كاملة'>('شهري');
  const [activationMonth, setActivationMonth] = useState<string>('أكتوبر');
  const [activationAmount, setActivationAmount] = useState<string>('50');
  const [activationSuccess, setActivationSuccess] = useState<{ code: string; name: string; phone: string; packageType: string } | null>(null);
  const [showManualOnlineModal, setShowManualOnlineModal] = useState<boolean>(false);
  const [manualOnlineName, setManualOnlineName] = useState<string>('');
  const [manualOnlinePhone, setManualOnlinePhone] = useState<string>('');
  const [manualOnlineMethod, setManualOnlineMethod] = useState<string>('فودافون كاش');
  const [isActivatingOnline, setIsActivatingOnline] = useState<boolean>(false);
  const [adminOnlineStudents, setAdminOnlineStudents] = useState<OnlineStudent[]>([]);
  const [onlineSearchTerm, setOnlineSearchTerm] = useState<string>('');
  const [copiedCodePhone, setCopiedCodePhone] = useState<string>('');
  const [adminActiveTab, setAdminActiveTab] = useState<string>('results');
  const [adminSort, setAdminSort] = useState<'alpha' | 'most' | 'least' | 'none' | 'blocked'>('alpha');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [resultsSearchQuery, setResultsSearchQuery] = useState<string>('');
  const [expandedAdminStudent, setExpandedAdminStudent] = useState<string | null>(null);
  const [adminSelectedUnit, setAdminSelectedUnit] = useState<string>('');
  const [showAdminScrollTop, setShowAdminScrollTop] = useState<boolean>(false);
  const adminScrollRef = useRef<HTMLDivElement>(null);
  
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [data, setData] = useState<Unit[]>([]); 

  const isLessonActive = (lessonId: string) => {
    if (publishedLessons.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') return true;
    return publishedLessons.includes(lessonId);
  };

  const studentUnits = useMemo(() => {
    return data.map(unit => ({
      ...unit,
      lessons: unit.lessons.filter(l => isLessonActive(l.id))
    })).filter(unit => unit.lessons.length > 0);
  }, [data, publishedLessons]); 

  const lessonStats = useMemo(() => {
    let total = 0;
    let published = 0;
    data.forEach(u => {
      u.lessons.forEach(l => {
        total++;
        if (isLessonActive(l.id)) published++;
      });
    });
    return {
      total,
      published,
      hidden: total - published,
      unitsCount: data.length
    };
  }, [data, publishedLessons]); 
  const [currentQIndex, setCurrentQIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [feedbackToast, setFeedbackToast] = useState<{ isCorrect: boolean; message: string } | null>(null);
  const [skippedQuestions, setSkippedQuestions] = useState<number[]>([]);
  const [showSkippedModal, setShowSkippedModal] = useState<boolean>(false);
  const [expandedUnits, setExpandedUnits] = useState<string[]>([]);
  const [adminExpandedUnits, setAdminExpandedUnits] = useState<string[]>([]);
  const [adminResultsLimit, setAdminResultsLimit] = useState<number>(40);
  const [studentsList, setStudentsList] = useState<Record<string, Student | Student[]>>({});
  const [isSyncingDrive, setIsSyncingDrive] = useState<boolean>(false);
  const [isSyncingLocal, setIsSyncingLocal] = useState<boolean>(false);
  
  const [revealedBlockStudents, setRevealedBlockStudents] = useState<string[]>([]);
  const studentClickData = useRef<Record<string, { count: number, time: number }>>({});

  const [isDesktop, setIsDesktop] = useState<boolean>(window.innerWidth >= 768);
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [lessonModalOptions, setLessonModalOptions] = useState<Lesson | null>(null);
  
  const getInitialTimeLeft = (lessonTitle: string, lessonId: string, questionsCount: number) => {
    if (timerMode === 'disabled') return null;
    let shouldApply = false;
    if (timerMode === 'all') shouldApply = true;
    else if (timerMode === 'custom_units' || timerMode === 'unit') {
      const isTargeted = data.some(u => timerUnitTargets.includes(u.id) && u.lessons.some(l => l.id === lessonId));
      if (isTargeted) shouldApply = true;
    }
    else if (timerMode === 'comprehensive') shouldApply = lessonTitle.includes('شامل') || lessonTitle.includes('امتحان') || lessonTitle.includes('نهائية');
    return shouldApply ? questionsCount * timerSecondsPerQ : null;
  };

  // Gamification XP & Levels State
  const [lessonScores, setLessonScores] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('lessonScores');
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  const totalXP = useMemo(() => Object.values(lessonScores).reduce((acc, curr) => acc + (curr * 10), 0), [lessonScores]);
  const getUserLevel = (xp: number) => {
    if (xp < 100) return { title: 'طالب مبتدئ', icon: '🥉' };
    if (xp < 300) return { title: 'باحث طموح', icon: '🥈' };
    if (xp < 600) return { title: 'بطل التاريخ', icon: '🥇' };
    if (xp < 1000) return { title: 'عبقري التاريخ', icon: '🏅' };
    return { title: 'أسطورة الكنز', icon: '👑' };
  };
  const levelInfo = getUserLevel(totalXP);

  // Daily Streak State
  const [streak, setStreak] = useState<{count: number, lastDate: string}>(() => {
    try {
      const saved = localStorage.getItem('userStreak');
      if (saved) {
        const parsed = JSON.parse(saved);
        const today = new Date().toDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (parsed.lastDate !== today && parsed.lastDate !== yesterday.toDateString()) {
          return { count: 0, lastDate: parsed.lastDate };
        }
        return parsed;
      }
    } catch(e) {}
    return { count: 0, lastDate: '' };
  });

  // Badges System State
  const [badges, setBadges] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('userBadges') || '[]'); } catch(e) { return []; }
  });

  // Global Audio Player states
  const [globalAudio, setGlobalAudio] = useState<{ url: string; title: string } | null>(null);
  const [isGlobalAudioPlaying, setIsGlobalAudioPlaying] = useState<boolean>(false);
  const [globalAudioTime, setGlobalAudioTime] = useState<number>(0);
  const [globalAudioDuration, setGlobalAudioDuration] = useState<number>(0);
  const [isAudioLoading, setIsAudioLoading] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const globalAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAudioTimeRef = useRef<number | null>(null);
  const lastSavedAudioTimeRef = useRef<number>(0);

  const formatAudioTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const toggleGlobalAudio = () => {
    if (!globalAudioRef.current) return;
    if (isGlobalAudioPlaying) {
      globalAudioRef.current.pause();
    } else {
      // في حال وجود خطأ سابق (كانقطاع الإنترنت)، نعيد تحميل الاتصال ونستأنف من نفس النقطة
      if (globalAudioRef.current.error && globalAudio) {
        globalAudioRef.current.load();
        globalAudioRef.current.currentTime = globalAudioTime;
      }
      globalAudioRef.current.play().catch(err => console.log('Playback error:', err));
    }
  };

  const togglePlaybackRate = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (globalAudioRef.current) {
      globalAudioRef.current.playbackRate = nextRate;
    }
  };

  const handleGlobalAudioTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const currentTime = e.currentTarget.currentTime;
    setGlobalAudioTime(currentTime);
    
    // حفظ التقدم كل 5 ثوانٍ لتجنب الضغط على الذاكرة المحلية
    if (globalAudio && Math.abs(currentTime - lastSavedAudioTimeRef.current) > 5) {
      localStorage.setItem(`audioProgress_${simpleHash(globalAudio.url)}`, currentTime.toString());
      lastSavedAudioTimeRef.current = currentTime;
    }
  };

  const handleGlobalAudioLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const duration = e.currentTarget.duration;
    setGlobalAudioDuration(duration);
    
    // استعادة التقدم المحفوظ بمجرد تحميل بيانات الملف الصوتي
    if (pendingAudioTimeRef.current !== null) {
      if (pendingAudioTimeRef.current < duration - 5) {
        e.currentTarget.currentTime = pendingAudioTimeRef.current;
        setGlobalAudioTime(pendingAudioTimeRef.current);
      }
      pendingAudioTimeRef.current = null;
    }
  };

  const handleGlobalAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (globalAudioRef.current) {
      globalAudioRef.current.currentTime = val;
      setGlobalAudioTime(val);
    }
  };

  const playLessonAudio = (url: string, title: string) => {
    if (globalAudio?.url === url) {
      toggleGlobalAudio();
    } else {
      // جلب التقدم المحفوظ إن وجد
      const savedTime = localStorage.getItem(`audioProgress_${simpleHash(url)}`);
      if (savedTime) {
        pendingAudioTimeRef.current = parseFloat(savedTime);
      } else {
        pendingAudioTimeRef.current = null;
      }
      lastSavedAudioTimeRef.current = pendingAudioTimeRef.current || 0;

      setIsAudioLoading(true);
      // تشغيل الصوت مباشرة داخل الحدث (Click) لتخطي حظر متصفحات الموبايل (Chrome/Safari)
      if (globalAudioRef.current) {
        globalAudioRef.current.src = getDirectAudioLink(url);
        globalAudioRef.current.playbackRate = playbackRate;
        globalAudioRef.current.load();
        const playPromise = globalAudioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsAudioLoading(false);
            // تفعيل التحكم في الصوت من شاشة القفل الخاصة بالموبايل واستمرار التشغيل في الخلفية
            if ('mediaSession' in navigator && (window as any).MediaMetadata) {
              try {
                navigator.mediaSession.metadata = new (window as any).MediaMetadata({
                  title: title,
                  artist: 'أ/ إسلام سعود',
                  album: 'موسوعة الكنز التعليمي',
                  // استخدام رابط كامل للصورة لمنع أخطاء الهواتف القديمة
                  artwork: [{ src: `${window.location.origin}/icon.png`, sizes: '512x512', type: 'image/png' }]
                });
              } catch(e) {}
            }
          }).catch(err => {
            console.log('Playback error on user click:', err);
            if (err.name === 'AbortError' || err.message.includes('abort')) return;
            setIsAudioLoading(false);
            // إعادة المحاولة مرة أخرى لاحتمالية تأخر جلب البيانات من السيرفر أو تقييد المتصفح
            setTimeout(() => {
              if (globalAudioRef.current) {
                globalAudioRef.current.play().catch(e => {
                  if (e.name === 'AbortError' || e.message.includes('abort')) return;
                  setIsGlobalAudioPlaying(false);
                });
              }
            }, 800);
          });
        }
      }
      setGlobalAudio({ url, title });
      setGlobalAudioTime(0);
      setGlobalAudioDuration(0);
      setIsGlobalAudioPlaying(true);
    }
  };

  useEffect(() => {
    // إيقاف وتفريغ المشغل فقط عند إغلاق الصوت، أما التشغيل فيتم في دالة playLessonAudio
    if (!globalAudio && globalAudioRef.current) {
      globalAudioRef.current.pause();
      globalAudioRef.current.removeAttribute('src');
      globalAudioRef.current.load();
      setIsGlobalAudioPlaying(false);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
      }
    }
  }, [globalAudio?.url]);
  
  // تفعيل أزرار التشغيل والإيقاف من شاشة قفل الموبايل أو شريط الإشعارات
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        if (globalAudioRef.current) {
          globalAudioRef.current.play();
          setIsGlobalAudioPlaying(true);
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (globalAudioRef.current) {
          globalAudioRef.current.pause();
          setIsGlobalAudioPlaying(false);
        }
      });
    }
  }, []);

  // خدعة برمجية لفتح قفل الصوت (Unlock Audio) في نظام iOS وأندرويد عند أول لمسة للشاشة
  useEffect(() => {
    const unlockAudio = () => {
      if (globalAudioRef.current && !globalAudioRef.current.src) {
         // تحميل مقطع صامت قصير جداً لتصريح المشغل من قبل النظام
         globalAudioRef.current.src = "data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
         globalAudioRef.current.load();
      }
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
  }, []);

  const [announcement, setAnnouncement] = useState<string>('');
  const [announcementInput, setAnnouncementInput] = useState<string>('');
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string>(() => {
    try {
      return localStorage.getItem('dismissedAnnouncement') || '';
    } catch(e) { return ''; }
  });
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  
  // Leaderboard State
  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);
  const [leaderboardData, setLeaderboardData] = useState<{name: string, score: number, testsCount: number, avg?: number, tier?: string, trend?: string}[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState<boolean>(false);
  const [currentUserStats, setCurrentUserStats] = useState<{
    testsCount: number;
    avg: number;
    passedUnit1: boolean;
    passedUnit3: boolean;
    passedEnough: boolean;
    tier: string;
    quizzes: Record<string, number>;
    globalRank?: number;
    missingRequired?: string[];
    completedRequired?: { name: string; score: number }[];
    unitRanks?: Record<string, { rank: number; totalStudents: number; avg: number; title: string }>;
  } | null>(null);
  const [showWhyModal, setShowWhyModal] = useState<boolean>(false);
  
  const [activeMapUrl, setActiveMapUrl] = useState<string | null>(null);
  const [mapsList, setMapsList] = useState<InteractiveMap[]>([]);
  
  const [mistakesBank, setMistakesBank] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('mistakesBank');
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  
  // PWA states and instructions
  const {
    deferredPrompt, setDeferredPrompt,
    showInstallBtn, setShowInstallBtn,
    isIOS,
    showIOSInstallGuide, setShowIOSInstallGuide,
    installTab, setInstallTab
  } = usePWA();

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSInstallGuide(true);
      return;
    }
    
    if (!deferredPrompt) {
      setShowIOSInstallGuide(true);
      return;
    }
    
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowInstallBtn(false);
      }
    } catch (err) {
      console.error('PWA installation prompt failed:', err);
      setShowIOSInstallGuide(true);
    }
  };

  interface DialogState {
    isOpen: boolean;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: (() => void) | null;
  }
  
  const [dialog, setDialog] = useState<DialogState>({ 
    isOpen: false, 
    message: '', 
    type: 'alert', 
    onConfirm: null 
  });
  
  const showAlert = (message: string) => setDialog({ isOpen: true, message, type: 'alert', onConfirm: null });
  const showConfirm = (message: string, onConfirm: () => void) => setDialog({ isOpen: true, message, type: 'confirm', onConfirm });
  const closeDialog = () => setDialog({ isOpen: false, message: '', type: 'alert', onConfirm: null });
  
  // تأثير العداد الزمني للاختبارات
  useEffect(() => {
    let timerId: ReturnType<typeof setInterval>;
    if (screen === 'quiz' && timeLeft !== null && timeLeft > 0) {
      timerId = setInterval(() => {
        setTimeLeft(prev => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearInterval(timerId);
            return 0; // سيؤدي هذا لتشغيل التأثير الآخر لإغلاق الاختبار
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [screen]);

  useEffect(() => {
    if (screen === 'quiz' && timeLeft === 0) {
      setTimeout(() => {
        showAlert('انتهى الوقت المخصص للاختبار! ⏰ تم تسجيل باقي الأسئلة كأخطاء، يمكنك الآن مراجعة الإجابات الصحيحة قبل إنهاء الاختبار.');
        handleTimeUpReview();
      }, 300);
    }
  }, [timeLeft, screen]);

  const prevSkippedCount = useRef<number>(0);
  useEffect(() => {
    if (screen === 'quiz') {
      if (prevSkippedCount.current > 0 && skippedQuestions.length === 0) {
        setTimeout(() => showAlert('لقد تم اكتمال حل الأسئلة التي تم تخطيها بنجاح! 🎉'), 500);
      }
      prevSkippedCount.current = skippedQuestions.length;
    } else {
      prevSkippedCount.current = 0;
    }
  }, [skippedQuestions.length, screen]);

  useEffect(() => {
    window.history.pushState({ screen: 'home' }, '');
    const handlePopState = () => {
      if (screen === 'quiz') {
        showConfirm('هل أنت متأكد من مغادرة الاختبار؟\nسيتم حفظ تقدمك الحالي.', () => setScreen('index'));
        window.history.pushState({ screen: 'quiz' }, ''); 
      }
      else if (screen === 'index') {
        window.history.pushState({ screen: 'index' }, ''); 
      }
      else if (screen === 'result') setScreen('index');
      else if (screen === 'admin') setScreen('home');
      else window.history.pushState(null, ''); 
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [screen]);
  
  useEffect(() => {
    if (screen === 'quiz' && activeLesson && activeLesson.id !== 'mistakes_bank') {
      const sessionData = { 
        lessonId: activeLesson.id, 
        unitId: data.find(u => u.lessons.some(l => l.id === activeLesson.id))?.id, 
        answers: userAnswers, 
        currentIndex: currentQIndex,
        questions: activeLesson.questions,
        timeLeft: timeLeft,
        skippedQuestions: skippedQuestions
      };
      localStorage.setItem('savedSession', JSON.stringify(sessionData));
    } else if (screen === 'result') {
      localStorage.removeItem('savedSession');
    }
  }, [screen, activeLesson, userAnswers, currentQIndex, data, timeLeft, skippedQuestions]);
  
  useEffect(() => {
    const loadStudents = async () => {
      try {
        const response = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}`);
        const result = await response.json();
        if(result.status === 'success') {
          if(result.data) {
            setStudentsList(result.data);
            const savedPhone = localStorage.getItem('loggedInPhone');
            const savedUserStr = localStorage.getItem('loggedInUser');
            if (savedPhone && savedUserStr) {
        let savedUser: Student | null = null;
        try { savedUser = JSON.parse(savedUserStr); } catch(e) {}
        if (savedUser) {
          let liveStudents = result.data[savedPhone];
          if (liveStudents) {
            if (!Array.isArray(liveStudents)) liveStudents = [liveStudents];
            const liveSt = (liveStudents as Student[]).find(s => s.name === savedUser?.name);
                  if (liveSt && ((liveSt as any).isBlocked || liveSt.isPaid === false || (liveSt.missingMonths && liveSt.missingMonths.length > 0))) {
              localStorage.removeItem('loggedInUser');
              localStorage.removeItem('loggedInPhone');
              setStudentData(null);
              setStudentName('');
              setScreen('home');
            } else if (!liveSt) {
              // إذا كان المستخدم المحفوظ في الذاكرة لا ينتمي لقائمة طلاب هذه المرحلة (مثلاً أخ في مرحلة أخرى)،
              // يتم تسجيل خروجه إجبارياً لمنع تسجيل النتائج باسم خاطئ.
              localStorage.removeItem('loggedInUser');
              localStorage.removeItem('loggedInPhone');
              setStudentData(null);
              setStudentName('');
              setScreen('home');
            }
          }
              }
            }
          }
          if(result.fee) setPlatformFee(result.fee);
          if(result.announcement !== undefined) setAnnouncement(result.announcement); 
          if(result.timerMode) { 
            setTimerMode(result.timerMode); 
            localStorage.setItem('timerMode', result.timerMode); 
          }
          if(result.timerUnitTarget) { 
            let parsed = [];
            try { parsed = JSON.parse(result.timerUnitTarget); if(!Array.isArray(parsed)) parsed = [result.timerUnitTarget]; } catch { parsed = [result.timerUnitTarget]; }
            setTimerUnitTargets(parsed); 
            localStorage.setItem('timerUnitTargets', JSON.stringify(parsed)); 
          }
          if(result.timerSecondsPerQ !== undefined) { 
            setTimerSecondsPerQ(Number(result.timerSecondsPerQ)); 
            localStorage.setItem('timerSecondsPerQ', result.timerSecondsPerQ.toString()); 
          }
          if(result.publishedLessons) { 
            try { 
              const parsed = JSON.parse(result.publishedLessons); 
              if(Array.isArray(parsed) && parsed.length > 0) { 
                setPublishedLessons(parsed); 
                localStorage.setItem('publishedLessons', JSON.stringify(parsed)); 
                localStorage.setItem('publishedLessons_init', 'true'); 
              } 
            } catch(e) {} 
          }
        }
      } catch(e) {}
    };
    loadStudents();
  }, []);
  
  useEffect(() => {
    const savedUser = localStorage.getItem('loggedInUser');
    const savedPhone = localStorage.getItem('loggedInPhone');
    if (savedUser && savedPhone) {
      try {
        const st: Student | null = JSON.parse(savedUser);
        // Safety check to ensure the parsed user is not null before using it
        if (st) {
          const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
          const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + savedPhone + '_' + st.name);
          if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
            localStorage.removeItem('loggedInUser');
            setStudentData(null);
            setStudentName('');
            setScreen('home');
            return;
          }
          setStudentData(st);
          setStudentName(st.name);
          setInputPhone(savedPhone);
          if (st.isPaid || !st.missingMonths || st.missingMonths.length === 0) {
            setScreen('returning_welcome');
          }
        }
      } catch(e) {}
      
      // Pre-fetch questions data to ensure stats.total is populated and ready immediately
      const prefetchCourseData = async () => {
        try {
          const noCache = new Date().getTime();
          const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`);
          const qData = await qRes.json();
          if (qData.status === 'success') {
            const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
            
            const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
            builtData.forEach(u => {
              u.lessons.forEach(l => {
                if (localCompleted.includes(l.id)) l.completed = true;
              });
            });

            setData(builtData);
            setExpandedUnits([]);
            if (qData.maps) setMapsList(qData.maps as InteractiveMap[]);
          }
        } catch (e) {
          console.error("Course prefetch error:", e);
        }
      };
      prefetchCourseData();
    }
  }, []);

  useEffect(() => {
    // Clean and crisp dynamic PWA icon renderer
    const generatePwaIcons = async () => {
      try {
        if (!('caches' in window)) return;
        const cache = await caches.open('kanz-cache-v1');
        const cachedIcon = await cache.match('./icon.png');
        if (cachedIcon) return; // already compiled

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = './icon.svg';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 512, 512);
            canvas.toBlob(async (blob) => {
              if (blob) {
                const response = new Response(blob, {
                  headers: { 'Content-Type': 'image/png' }
                });
                await cache.put('./icon.png', response.clone());
                await cache.put('./apple-touch-icon.png', response);
              }
            }, 'image/png');
          }
        };
      } catch (e) {
        console.warn(e);
      }
    };
    generatePwaIcons();
  }, []);
  
  useEffect(() => {
    setAnnouncementInput(announcement);
  }, [announcement]);
  
  const toggleUnit = (unitId: string) => setExpandedUnits(prev => prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]);
  const toggleAdminUnit = (unitId: string) => setAdminExpandedUnits(prev => prev.includes(unitId) ? prev.filter(id => id !== unitId) : [...prev, unitId]);
  
  const toggleFullscreen = () => { 
    if (!document.fullscreenElement) { 
      document.documentElement.requestFullscreen().catch(e => console.log(e)); 
      setIsFullscreen(true); 
    } else { 
      document.exitFullscreen(); 
      setIsFullscreen(false); 
    } 
  };
  
  const stats = useMemo(() => {
    let total = 0, completed = 0;
    studentUnits.forEach(unit => { 
      unit.lessons.forEach(l => { 
        total++; 
        if (l.completed) completed++; 
      }); 
    });
    return { 
      total, 
      completed, 
      remaining: total - completed, 
      progress: total ? Math.round((completed/total)*100) : 0 
    };
  }, [studentUnits]);
  
  useEffect(() => {
    if (stats.total > 0) {
      localStorage.setItem('userStats', JSON.stringify(stats));
    }
  }, [stats]);
  
  const handleResume = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
      const qData = await qRes.json();
      if (qData.status === 'success') {
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
        
        // --- START: Force server sync on resume ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = studentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) correctName = matchedStudent.name;
                  else if (stArr.length === 1) correctName = stArr[0].name;
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                  } else {
                    for(const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '', totalQs = 0;
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) { const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz)); if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; } }
                if (foundLessonId && restoredScores[foundLessonId] === undefined) { restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs); completedIds.add(foundLessonId); }
              });

              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                      }
                    } else {
                      for(const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });

              localStorage.setItem('lessonScores', JSON.stringify(restoredScores));
              localStorage.setItem('completedLessons', JSON.stringify(Array.from(completedIds)));
              setLessonScores(restoredScores);
            }
          } catch(e) { console.error(e); }
        }
        // --- END: Force server sync on resume ---
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        const session = localStorage.getItem('savedSession');
        if (session) {
          let parsedSession: any = null;
          try { parsedSession = JSON.parse(session); } catch(e) {}
          if (parsedSession) {
            let foundLesson: Lesson | null = null;
            for (const u of builtData) {
              const l = u.lessons.find(ls => ls.id === parsedSession.lessonId);
              if (l) { foundLesson = l; break; }
            }
            if (foundLesson) {
              const restoredLesson = { 
                ...foundLesson, 
                questions: parsedSession.questions || foundLesson.questions 
              };
              setActiveLesson(restoredLesson); 
              setUserAnswers(parsedSession.answers || []); 
              setCurrentQIndex(parsedSession.currentIndex || 0); 
              setTimeLeft(parsedSession.timeLeft !== undefined ? parsedSession.timeLeft : null);
              setSkippedQuestions(parsedSession.skippedQuestions || []);
              setScreen('quiz');
            } else {
              setScreen('index');
            }
          } else {
            setScreen('index');
          }
        } else {
          setScreen('index');
        }
      } else { 
        setLoginError("فشل تحميل الأسئلة من السيرفر."); 
        setScreen('home'); 
      }
    } catch(e) { 
      setLoginError("حدث خطأ أثناء جلب الأسئلة."); 
      setScreen('home'); 
    }
    setIsLoading(false);
  };
  
  const handleStartFresh = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
      const qData = await qRes.json();
      if (qData.status === 'success') {
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);

        // --- START: Force server sync on start fresh ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = studentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) correctName = matchedStudent.name;
                  else if (stArr.length === 1) correctName = stArr[0].name;
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                  } else {
                    for(const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '', totalQs = 0;
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) { const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz)); if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; } }
                if (foundLessonId && restoredScores[foundLessonId] === undefined) { restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs); completedIds.add(foundLessonId); }
              });
              
              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => { delete restoredScores[l.id]; completedIds.delete(l.id); });
                      }
                    } else {
                      for(const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });

              localStorage.setItem('lessonScores', JSON.stringify(restoredScores));
              localStorage.setItem('completedLessons', JSON.stringify(Array.from(completedIds)));
              setLessonScores(restoredScores);
            }
          } catch(e) { console.error(e); }
        }
        // --- END: Force server sync on start fresh ---
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        setScreen('index');
      } else { 
        setLoginError("فشل تحميل الأسئلة من السيرفر."); 
        setScreen('home'); 
      }
    } catch(e) { 
      setLoginError("حدث خطأ أثناء جلب الأسئلة."); 
      setScreen('home'); 
    }
    setIsLoading(false);
  };
  
  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const noCache = new Date().getTime();
      const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const qData = await qRes.json();
      
      const sRes = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const sData = await sRes.json();
      
      if (qData.status === 'success') {
        const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
        
        // --- مزامنة ومطابقة النتائج مع جوجل شيتس لحل مشكلة اختلاف رقم المنجز ---
        if (studentName && inputPhone) {
          try {
            const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
            const resData = await res.json();
            if (resData.status === 'success') {
              const chronologicalData = [...resData.data].reverse() as TestResult[];
              const formattedPhone = formatPhoneStr(inputPhone);
              
              let currentStudentsList = studentsList;
              if (sData && sData.status === 'success' && sData.data) {
                currentStudentsList = sData.data;
              }

              const myResults = chronologicalData.filter(r => {
                let correctName = r.name;
                const fPhone = formatPhoneStr(r.phone);
                if (fPhone !== formattedPhone) return false;

                const stRecord = currentStudentsList[fPhone];
                if (stRecord) {
                  const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                  if (matchedStudent) {
                    correctName = matchedStudent.name;
                  } else if (stArr.length === 1) {
                    correctName = stArr[0].name;
                  }
                }
                return correctName.trim() === studentName.trim();
              });

              const restoredScores: Record<string, number> = {};
              const completedIds: Set<string> = new Set();
              const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
              
              myResults.forEach(r => {
                if (isAmbiguousOldQuiz(r.quiz)) return;
                
                if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                  if (r.quiz.includes('تصفير الوحدة')) {
                    const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                    const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                    if (unitToReset) {
                      unitToReset.lessons.forEach(l => {
                        delete restoredScores[l.id];
                        completedIds.delete(l.id);
                      });
                    }
                  } else {
                    for (const key in restoredScores) delete restoredScores[key];
                    completedIds.clear();
                  }
                  return;
                }
                
                const scoreNum = normalizeScore(r.score);
                let foundLessonId = '';
                let totalQs = 0;
                
                const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                for (const u of builtData) {
                  const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz));
                  if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                }
                
                if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                  restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                  completedIds.add(foundLessonId);
                }
              });
              
              // دمج الدرجات التي لم ترفع للسيرفر بعد (أوفلاين)
              const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
              offlineResults.forEach((offlineRes: any) => {
                  if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                  
                  if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                    if (offlineRes.quiz.includes('تصفير الوحدة')) {
                      const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                      const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                      if (unitToReset) {
                        unitToReset.lessons.forEach(l => {
                          delete restoredScores[l.id];
                          completedIds.delete(l.id);
                        });
                      }
                    } else {
                      for (const key in restoredScores) delete restoredScores[key];
                      completedIds.clear();
                    }
                    return;
                  }

                  const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                  let foundLessonId = '', totalQs = 0;
                  for (const u of builtData) {
                    const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                    if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                  }
                  if (foundLessonId && restoredScores[foundLessonId] === undefined) {
                    const scoreNum = normalizeScore(offlineRes.score);
                    restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                    completedIds.add(foundLessonId);
                  }
              });
              
              const finalScores = restoredScores;
              const finalCompleted = Array.from(completedIds);
              
              localStorage.setItem('lessonScores', JSON.stringify(finalScores));
              localStorage.setItem('completedLessons', JSON.stringify(finalCompleted));
              setLessonScores(finalScores);
            }
          } catch(e) { console.error(e); }
        }
        
        const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
        builtData.forEach(u => {
          u.lessons.forEach(l => {
            if (localCompleted.includes(l.id)) l.completed = true;
          });
        });
        // --- نهاية المزامنة ---

        setData(builtData);
        setExpandedUnits([]);
        if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
        if (sData.status === 'success') {
          if (sData.announcement !== undefined) setAnnouncement(sData.announcement);
          if (sData.fee) setPlatformFee(sData.fee);
          if (sData.data) setStudentsList(sData.data);
          if(sData.timerMode) { 
            setTimerMode(sData.timerMode); 
            localStorage.setItem('timerMode', sData.timerMode); 
          }
          if(sData.timerUnitTarget) { 
            let parsed = [];
            try { parsed = JSON.parse(sData.timerUnitTarget); if(!Array.isArray(parsed)) parsed = [sData.timerUnitTarget]; } catch { parsed = [sData.timerUnitTarget]; }
            setTimerUnitTargets(parsed); 
            localStorage.setItem('timerUnitTargets', JSON.stringify(parsed)); 
          }
          if(sData.timerSecondsPerQ !== undefined) { 
            setTimerSecondsPerQ(Number(sData.timerSecondsPerQ)); 
            localStorage.setItem('timerSecondsPerQ', sData.timerSecondsPerQ.toString()); 
          }
          if(sData.publishedLessons) { 
            try { 
              const parsed = JSON.parse(sData.publishedLessons); 
              if(Array.isArray(parsed) && parsed.length > 0) { 
                setPublishedLessons(parsed); 
                localStorage.setItem('publishedLessons', JSON.stringify(parsed)); 
                localStorage.setItem('publishedLessons_init', 'true'); 
              } 
            } catch(e) {} 
          }
        }
        showAlert('تم تحديث المحتوى والإشعارات بنجاح! 🚀');
      } else {
        showAlert("فشل التحديث من السيرفر.");
      }
    } catch(e) {
      showAlert("حدث خطأ أثناء جلب التحديثات.");
    }
    setIsLoading(false);
  };
  
  const handleLogout = () => {
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('loggedInPhone');
    setStudentData(null);
    setStudentName('');
    setInputPhone('');
    setInputPassword('');
    setShowPasswordInput(false);
    setScreen('home');
  };
  
  const handleResetUnit = (unitId: string) => {
    const unitToReset = data.find(u => u.id === unitId);
    if (!unitToReset) return;

    showConfirm(`هل أنت متأكد من تصفير الوحدة "${unitToReset.title}"؟\nسيتم مسح جميع درجاتك في دروس هذه الوحدة فقط وستبدأ من جديد.`, () => {
        const lessonIdsToReset = unitToReset.lessons.map(l => l.id);
        const lessonQuestionsToReset = unitToReset.lessons.flatMap(l => l.questions.map(q => simpleHash(q.q)));

        saveResultToDB({
            quizName: `تصفير الوحدة 🔄: ${unitToReset.title}`,
            score: 'تصفير 🔄'
        });

        setLessonScores(prev => {
            const newScores = { ...prev };
            lessonIdsToReset.forEach(id => { delete newScores[id]; });
            localStorage.setItem('lessonScores', JSON.stringify(newScores));
            return newScores;
        });

        const newCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]').filter((id: string) => !lessonIdsToReset.includes(id));
        localStorage.setItem('completedLessons', JSON.stringify(newCompleted));

        setData(prevData => {
            return prevData.map(unit => {
                if (unit.id === unitId) {
                    return { ...unit, lessons: unit.lessons.map(l => ({ ...l, completed: false })) };
                }
                return unit;
            });
        });

        setMistakesBank(prev => {
            const newBank = prev.filter(q => !lessonQuestionsToReset.includes(simpleHash(q.q)));
            localStorage.setItem('mistakesBank', JSON.stringify(newBank));
            return newBank;
        });
        
        const session = localStorage.getItem('savedSession');
        if (session) {
            const parsed = JSON.parse(session);
            if (lessonIdsToReset.includes(parsed.lessonId)) localStorage.removeItem('savedSession');
        }

        showAlert(`تم تصفير وحدة "${unitToReset.title}" بنجاح. يمكنك الآن البدء من جديد.`);
    });
  };

  const handleLogin = async () => {
    setLoginError(''); 
    const formattedPhone = formatPhoneStr(inputPhone);
    if (!formattedPhone || formattedPhone.length < 10) { 
      setLoginError('يرجى إدخال رقم هاتف صحيح.'); 
      return; 
    }
    setIsLoading(true);
    
    const loadQuestionsAndNavigate = async (targetScreen: string, stPhone: string, stName: string, knownStudentsArr?: Student[]) => {
      try {
        const noCache = new Date().getTime();
        const qRes = await fetch(`${API_URL}?action=getQuestions&apiKey=${SECRET_API_KEY}&t=${noCache}`); 
        const qData = await qRes.json();
        if (qData.status === 'success') {
          const builtData = buildCourseData(qData.data as FlatQuestionRow[]);
          
          if (targetScreen === 'index') {
            try {
              const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
              const resData = await res.json();
              if (resData.status === 'success') {
                const chronologicalData = [...resData.data].reverse() as TestResult[];
                
                const myResults = chronologicalData.filter(r => {
                  let correctName = r.name;
                  const fPhone = formatPhoneStr(r.phone);
                  if (fPhone !== stPhone) return false;

                  let stArr = knownStudentsArr;
                  if (!stArr) {
                    const stRecord = studentsList[fPhone];
                    if (stRecord) stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
                  }

                  if (stArr) {
                    const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
                    if (matchedStudent) {
                      correctName = matchedStudent.name;
                    } else if (stArr.length === 1) {
                      correctName = stArr[0].name;
                    }
                  }
                  return correctName.trim() === stName.trim();
                });

                if (myResults.length > 0) {
                  const restoredScores: Record<string, number> = {};
                  const completedIds: Set<string> = new Set();
                  const currentValidLessons = builtData.flatMap(u => u.lessons.map(l => l.title));
                  
                  let fullResetHit = false;
                  const resetLessonIds: Set<string> = new Set();
                  
                  myResults.forEach(r => {
                    if (isAmbiguousOldQuiz(r.quiz)) return;
                    if (fullResetHit) return;
                    
                    if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
                      if (r.quiz.includes('تصفير الوحدة')) {
                        const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                        const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                        if (unitToReset) {
                          unitToReset.lessons.forEach(l => resetLessonIds.add(l.id));
                        }
                      } else {
                        fullResetHit = true;
                      }
                      return;
                    }
                    
                    const scoreNum = normalizeScore(r.score);
                    let foundLessonId = '';
                    let totalQs = 0;
                    
                    const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
                    
                    for (const u of builtData) {
                      const l = u.lessons.find(ls => ls.title === (mappedTitle || r.quiz));
                      if (l) {
                        foundLessonId = l.id;
                        totalQs = l.questions.length;
                        break;
                      }
                    }
                    
                    if (foundLessonId && !resetLessonIds.has(foundLessonId) && restoredScores[foundLessonId] === undefined) {
                      const correctCount = Math.round((scoreNum / 100) * totalQs);
                      restoredScores[foundLessonId] = correctCount;
                      completedIds.add(foundLessonId);
                    }
                  });
                  
                  const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
                  offlineResults.forEach((offlineRes: any) => {
                      if (isAmbiguousOldQuiz(offlineRes.quiz)) return;
                      if (fullResetHit) return;
                      
                      if (offlineRes.quiz.includes('تصفير') || String(offlineRes.score).includes('تصفير')) {
                        if (offlineRes.quiz.includes('تصفير الوحدة')) {
                          const unitTitleToReset = offlineRes.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                          const unitToReset = builtData.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                          if (unitToReset) {
                            unitToReset.lessons.forEach(l => resetLessonIds.add(l.id));
                          }
                        } else {
                          fullResetHit = true;
                        }
                        return;
                      }

                      const mappedTitle = matchQuizToCurrent(offlineRes.quiz, currentValidLessons);
                      let foundLessonId = '', totalQs = 0;
                      for (const u of builtData) {
                        const l = u.lessons.find(ls => ls.title === (mappedTitle || offlineRes.quiz));
                        if (l) { foundLessonId = l.id; totalQs = l.questions.length; break; }
                      }
                      if (foundLessonId && !resetLessonIds.has(foundLessonId) && restoredScores[foundLessonId] === undefined) {
                        const scoreNum = normalizeScore(offlineRes.score);
                        restoredScores[foundLessonId] = Math.round((scoreNum / 100) * totalQs);
                        completedIds.add(foundLessonId);
                      }
                  });

                  const finalScores = restoredScores;
                  const finalCompleted = Array.from(completedIds);
                  
                  localStorage.setItem('lessonScores', JSON.stringify(finalScores));
                  localStorage.setItem('completedLessons', JSON.stringify(finalCompleted));
                  setLessonScores(finalScores);
                }
              }
            } catch(e) {
               console.error("Restore failed", e);
            }
          }

          const localCompleted = JSON.parse(localStorage.getItem('completedLessons') || '[]');
          builtData.forEach(u => {
            u.lessons.forEach(l => {
              if (localCompleted.includes(l.id)) l.completed = true;
            });
          });
          
          setData(builtData);
          setExpandedUnits([]);
          if (qData.maps) setMapsList(qData.maps as InteractiveMap[]); else setMapsList([]); 
          setScreen(targetScreen); 
        } else {
          setLoginError("فشل تحميل الأسئلة من السيرفر.");
        }
      } catch(e) { 
        setLoginError("حدث خطأ أثناء جلب الأسئلة."); 
      }
    };
    
    if (BASE_STUDENTS[formattedPhone]) {
      if (!showPasswordInput) { 
        setShowPasswordInput(true); 
        setIsLoading(false); 
        return; 
      }
      const user = BASE_STUDENTS[formattedPhone];
      const inputHash = simpleHash(inputPassword);
      if (inputHash === user.passHash) {
        setStudentName(user.name);
        if (user.role === 'admin') { 
          fetchAdminData(); 
          await loadQuestionsAndNavigate('admin', formattedPhone, user.name); 
        } else if (user.role === 'secretary') { 
          await loadQuestionsAndNavigate('index', formattedPhone, user.name); 
        }
        setShowPasswordInput(false); 
        setInputPassword('');
      } else {
        setLoginError("الرقم السري خاطئ.");
      }
      setIsLoading(false); 
      return;
    }
    
    let localStudents = studentsList[formattedPhone];
    if (localStudents) {
      if (!Array.isArray(localStudents)) localStudents = [localStudents];
      const studentsArr = localStudents as Student[];
      if (studentsArr.length > 1 && !selectedTwin) { 
        setLoginError('اختر اسمك من القائمة أولاً.'); 
        setIsLoading(false); 
        return; 
      }
      const st = selectedTwin || studentsArr[0];
      
      if ((st as any).isBlocked) {
        setLoginError('تم حظر هذا الحساب، برجاء التواصل مع الإدارة على الرقم: 01228466613');
        setIsLoading(false);
        return;
      }

      if (st.isPaid === false || (st.missingMonths && st.missingMonths.length > 0)) {
        setStudentData(st); 
        setShowUnpaidModal(true); 
        setIsLoading(false); 
        return;
      }
      
      const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
      const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name);

      if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
        if (!showPasswordInput) {
          setShowPasswordInput(true);
          setIsLoading(false);
          return;
        }
        const enteredCode = inputPassword.trim().toUpperCase();
        const expectedCode = st.code.trim().toUpperCase();
        if (enteredCode !== expectedCode) {
          setLoginError('كود الطالب غير صحيح، برجاء التأكد من كتابة الكود بشكل صحيح.');
          setIsLoading(false);
          return;
        }
        localStorage.setItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name, currentMonthKey);
        setShowPasswordInput(false);
        setInputPassword('');
      }

      const proceedWithLocalLogin = async () => {
        setStudentName(st.name); 
        setStudentData(st);
        
        const fingerprint = generateDeviceFingerprint();
        try {
          const fpRes = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
              action: 'saveDeviceFingerprint', 
              phone: `${formattedPhone}_${st.name}`, 
              fingerprint: fingerprint, 
              apiKey: SECRET_API_KEY 
            }) 
          });
          const fpData = await fpRes.json();
          if (fpData.status === 'blocked') { 
            setLoginError('لا يمكن فتح التطبيق! لقد سبق واستخدم هذا الحساب في متصفح أو جهاز آخر. برجاء التواصل مع الإدارة لفك الارتباط.'); 
            setIsLoading(false); 
            return; 
          }
        } catch(e) {}
        
        localStorage.setItem('loggedInUser', JSON.stringify(st));
        localStorage.setItem('loggedInPhone', formattedPhone);
        await loadQuestionsAndNavigate('index', formattedPhone, st.name, studentsArr);
        setIsLoading(false); 
      };

      if (st.graceMonths && st.graceMonths.length > 0) {
        setStudentData(st);
        setPendingGraceLogin(() => proceedWithLocalLogin);
        setShowGraceModal(true);
        setIsLoading(false);
        return;
      }

      await proceedWithLocalLogin();
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}?action=login&phone=${formattedPhone}&apiKey=${SECRET_API_KEY}`);
      const result = await response.json();
      if (result.status === 'success') {
        const fetchedStudents: Student[] = Array.isArray(result.student) ? result.student : [result.student];
        if (fetchedStudents.length > 1 && !selectedTwin) {
          setStudentsList(prev => ({...prev, [formattedPhone]: fetchedStudents}));
          setLoginError('الرجاء اختيار اسمك أولاً.'); 
          setIsLoading(false); 
          return;
        }
        const st = selectedTwin || fetchedStudents[0];
        
        if ((st as any).isBlocked) {
          setLoginError('تم حظر هذا الحساب، برجاء التواصل مع الإدارة على الرقم: 01228466613');
          setIsLoading(false);
          return;
        }

        if (st.isPaid === false || (st.missingMonths && st.missingMonths.length > 0)) {
          setStudentData(st); 
          setShowUnpaidModal(true); 
          setIsLoading(false); 
          return;
        }
        
        const currentMonthKey = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        const savedVerifiedMonth = localStorage.getItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name);

        if (st.code && st.code.trim() !== '' && savedVerifiedMonth !== currentMonthKey) {
          if (!showPasswordInput) {
            setShowPasswordInput(true);
            setIsLoading(false);
            return;
          }
          const enteredCode = inputPassword.trim().toUpperCase();
          const expectedCode = st.code.trim().toUpperCase();
          if (enteredCode !== expectedCode) {
            setLoginError('كود الطالب غير صحيح، برجاء التأكد من كتابة الكود بشكل صحيح.');
            setIsLoading(false);
            return;
          }
          localStorage.setItem('verifiedStudentMonth_' + formattedPhone + '_' + st.name, currentMonthKey);
          setShowPasswordInput(false);
          setInputPassword('');
        }
        if (st.graceMonths && st.graceMonths.length > 0) {
          setStudentData(st);
          setPendingGraceLogin(() => async () => {
            setStudentName(st.name); 
            setStudentData(st);
            localStorage.setItem('loggedInUser', JSON.stringify(st));
            localStorage.setItem('loggedInPhone', formattedPhone);
            await loadQuestionsAndNavigate('index', formattedPhone, st.name, fetchedStudents);
            setIsLoading(false);
          });
          setShowGraceModal(true);
          setIsLoading(false);
          return;
        }

        setStudentName(st.name); 
        setStudentData(st);
        
        const fingerprint = generateDeviceFingerprint();
        const fpRes = await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'saveDeviceFingerprint', 
            phone: `${formattedPhone}_${st.name}`, 
            fingerprint: fingerprint, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        const fpData = await fpRes.json();
        if (fpData.status === 'blocked') { 
          setLoginError('لا يمكن فتح التطبيق! لقد سبق واستخدم هذا الحساب في متصفح آخر.'); 
          setIsLoading(false); 
          return; 
        }
        
        localStorage.setItem('loggedInUser', JSON.stringify(st));
        localStorage.setItem('loggedInPhone', formattedPhone);
        await loadQuestionsAndNavigate('index', formattedPhone, st.name, fetchedStudents);
      } else if (result.status === 'unregistered' || result.message === 'الرقم غير مسجل لدينا.') {
        const reqRes = await fetch(`${API_URL}?action=getPendingRequests&apiKey=${SECRET_API_KEY}`); 
        const reqData = await reqRes.json();
        if (reqData.status === 'success' && reqData.data && (reqData.data as PendingRequest[]).some(r => formatPhoneStr(r.phone) === formattedPhone)) {
          setLoginError('طلبك قيد مراجعة الإدارة.');
        } else {
          setShowWelcomeSubscribeModal(true);
        }
      } else {
        setLoginError(result.message || 'حدث خطأ.');
      }
    } catch (error) { 
      setLoginError('خطأ في الاتصال بالإنترنت.'); 
    }
    setIsLoading(false);
  };

  const handleOpenLeaderboard = async () => {
    setShowLeaderboard(true);
    setIsLoadingLeaderboard(true);
    try {
      const noCache = new Date().getTime();
      const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}&t=${noCache}`);
      const resData = await res.json();
      if (resData.status === 'success') {
        const grouped: Record<string, { quizzes: Record<string, number>, latestTestOriginalIndex: number }> = {};
        const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
        
        // إعداد قاموس لعدد أسئلة كل درس لتحويل النسب إلى XP مطابق للصفحة الرئيسية
        const titleToQsMap: Record<string, number> = {};
        data.forEach(u => u.lessons.forEach(l => { titleToQsMap[l.title] = l.questions.length; }));
        
        const chronologicalData = [...resData.data].reverse() as TestResult[];
        chronologicalData.forEach((r, idx) => {
          let correctName = r.name;
          const formattedPhone = formatPhoneStr(r.phone);
          const stRecord = studentsList[formattedPhone];

          if (stRecord) {
            const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
            const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());
            
            if (matchedStudent) {
              correctName = matchedStudent.name;
            } else {
              if (stArr.length === 1) {
                correctName = stArr[0].name;
              }
            }
          }

          if (!grouped[correctName]) grouped[correctName] = { quizzes: {}, firstAttemptIndices: {} };
          
          if (isAmbiguousOldQuiz(r.quiz)) return;

          // تصفير سجل الطالب إذا قام بالتصفير للبدء من جديد واعتبار ما بعده محاولة أولى جديدة
          if (r.quiz.includes('تصفير') || String(r.score).includes('تصفير')) {
            if (r.quiz.includes('تصفير الوحدة')) { // تصفير وحدة
              const unitTitleToReset = r.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
              const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
              if (unitToReset) {
                  unitToReset.lessons.forEach(l => {
                      delete grouped[correctName].quizzes[l.title];
                      delete grouped[correctName].firstAttemptIndices[l.title];
                  });
              }
            } else { // تصفير كامل
              grouped[correctName].quizzes = {};
              grouped[correctName].firstAttemptIndices = {};
            }
            return; // الانتقال للنتيجة التالية بعد معالجة التصفير
          }

          const mappedTitle = matchQuizToCurrent(r.quiz, currentValidLessons);
          if (mappedTitle) {
              const scoreNum = normalizeScore(r.score);
              if (grouped[correctName].quizzes[mappedTitle] === undefined) {
                grouped[correctName].quizzes[mappedTitle] = scoreNum;
                grouped[correctName].firstAttemptIndices[mappedTitle] = idx;
              }
          }
        });
        
        const activeLessons = data.flatMap(u => u.lessons).filter(l => isLessonActive(l.id));
        const requiredCurrentTitles = activeLessons.map(l => l.title);

        const mapped = Object.keys(grouped).map(name => {
          const studentData = grouped[name];
          const uniqueQuizzes = Object.keys(studentData.quizzes);
          
          if (requiredCurrentTitles.length > 0 && !requiredCurrentTitles.every(reqTitle => uniqueQuizzes.includes(reqTitle))) {
            return null;
          }

          let totalXP = 0;
          let sumPerc = 0;
          let studentLatestTest = -1;
          uniqueQuizzes.forEach(q => {
            const perc = studentData.quizzes[q];
            sumPerc += perc;
            const tQs = titleToQsMap[q] || 0;
            totalXP += Math.round((perc / 100) * tQs) * 10;
            
            const attemptIdx = studentData.firstAttemptIndices[q];
            if (attemptIdx > studentLatestTest) studentLatestTest = attemptIdx;
          });

          const score = totalXP;
          const testsCount = uniqueQuizzes.length;
          const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
          
          // شرط الاستبعاد الصارم: أي طالب يقل معدله عن 80% لا يدخل أي قائمة نهائياً
          if (avg < 80) {
            return null;
          }
          
          let trend = 'flat';
          if (testsCount > 1) {
            const lastQuiz = uniqueQuizzes[uniqueQuizzes.length - 1];
            const lastPerc = studentData.quizzes[lastQuiz];
            const prevPercSum = sumPerc - lastPerc;
            const prevAvg = Math.round(prevPercSum / (testsCount - 1));
            if (lastPerc > prevAvg + 2) trend = 'up';
            else if (lastPerc < prevAvg - 2) trend = 'down';
            else if (lastPerc === 100 && avg >= 95) trend = 'up';
          } else if (testsCount === 1) {
            if (avg >= 90) trend = 'up';
            else if (avg <= 75) trend = 'down';
          }
          
          return { name, score, testsCount, avg, trend, latestTestOriginalIndex: studentLatestTest };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
        
        const sorted = mapped.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if (b.testsCount !== a.testsCount) {
            return b.testsCount - a.testsCount;
          }
          if (b.avg !== a.avg) {
            return b.avg - a.avg;
          }
          if (a.latestTestOriginalIndex !== b.latestTestOriginalIndex) {
            return a.latestTestOriginalIndex - b.latestTestOriginalIndex; // صاحب الرقم الأقل (الأقدم) هو الفائز في التشابه
          }
          return a.name.localeCompare(b.name, 'ar');
        });
        
        let goldCount = 0;
        let silverCount = 0;
        let bronzeCount = 0;
        
        const limitedSorted: {name: string, score: number, testsCount: number, avg: number, tier: string, trend: string, latestTestOriginalIndex?: number}[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const s = sorted[i];
          let tier = '';
          // القائمة الذهبية: بحد أقصى 10 طلاب، وبشرط معدل 90% فما فوق (المراكز 1 إلى 10)
          if (goldCount < 10 && s.avg >= 90) {
            tier = 'gold';
            goldCount++;
          } 
          // القائمة الفضية: بحد أقصى 10 طلاب (المراكز 11 إلى 20 أو الفائض من الذهبية) بمعدل 80% فما فوق
          else if (silverCount < 10) {
            tier = 'silver';
            silverCount++;
          } 
          // القائمة البرونزية: بحد أقصى 10 طلاب (المراكز 21 إلى 30) بمعدل 80% فما فوق
          else if (bronzeCount < 10) {
            tier = 'bronze';
            bronzeCount++;
          }
          if (tier) {
            limitedSorted.push({ ...s, tier, trend: s.trend });
          }
          if (goldCount + silverCount + bronzeCount >= 30) break;
        }

        let currentUserCurrentStats = null;
        if (studentName && grouped[studentName]) {
          const studentData = grouped[studentName];
          const uniqueQuizzes = Object.keys(studentData.quizzes);
          
          let sumPerc = 0;
          uniqueQuizzes.forEach(q => sumPerc += studentData.quizzes[q]);
          const testsCount = uniqueQuizzes.length;
          const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
          
          const isEligible = requiredCurrentTitles.length > 0 && requiredCurrentTitles.every(reqTitle => 
              uniqueQuizzes.includes(reqTitle)
          ) && avg >= 80;
          
          const passedUnit1 = true;
          const passedUnit3 = true;
          
          const studentGlobalRank = sorted.findIndex(s => s.name === studentName) + 1;

          const missingRequired: string[] = [];
          const completedRequired: { name: string; score: number }[] = [];
          
          requiredCurrentTitles.forEach(reqTitle => {
              if (uniqueQuizzes.includes(reqTitle)) {
                  completedRequired.push({ name: reqTitle, score: studentData.quizzes[reqTitle] });
              } else {
                  missingRequired.push(reqTitle);
              }
          });

          // --- NEW: Calculate Unit-specific Ranks ---
          const unitRanks: Record<string, { rank: number; totalStudents: number; avg: number; title: string }> = {};
          data.forEach(unit => {
              if (unit.lessons.length === 0) return;
      
              const unitLessonTitles = unit.lessons.map(l => l.title);
              
              const unitLeaderboard = Object.keys(grouped).map(name => {
                  const studentData = grouped[name];
                  const studentQuizzes = studentData.quizzes;
      
                  const completedAllUnitLessons = unitLessonTitles.every(lessonTitle => 
                      Object.keys(studentQuizzes).includes(lessonTitle)
                  );
      
                  if (!completedAllUnitLessons) return null;
      
                  let unitScore = 0;
                  unitLessonTitles.forEach(lessonTitle => {
                      unitScore += studentQuizzes[lessonTitle] || 0;
                  });
                  
                  const unitAvg = unitLessonTitles.length > 0 ? Math.round(unitScore / unitLessonTitles.length) : 0;
      
                  return { name, unitScore, unitAvg };
              }).filter((item): item is NonNullable<typeof item> => item !== null);
      
              const sortedUnitLeaderboard = unitLeaderboard.sort((a, b) => b.unitScore - a.unitScore);
      
              const userUnitRank = sortedUnitLeaderboard.findIndex(s => s.name === studentName) + 1;
      
              if (userUnitRank > 0) {
                  const userUnitData = sortedUnitLeaderboard.find(s => s.name === studentName);
                  unitRanks[unit.id] = {
                      rank: userUnitRank,
                      totalStudents: sortedUnitLeaderboard.length,
                      avg: userUnitData?.unitAvg || 0,
                      title: unit.title
                  };
              }
          });

          currentUserCurrentStats = {
            testsCount,
            avg,
            passedUnit1,
            passedUnit3,
            passedEnough: isEligible,
            tier: isEligible ? 'eligible' : '',
            quizzes: studentData.quizzes,
            globalRank: studentGlobalRank,
            missingRequired,
            completedRequired,
            unitRanks
          };
        }
        setCurrentUserStats(currentUserCurrentStats);
        
        setLeaderboardData(limitedSorted);
      }
    } catch(e) {
      console.error("Failed to load leaderboard");
    }
    setIsLoadingLeaderboard(false);
  };

  const downloadTierBoard = (tier: string, title: string, color: string) => {
    const tierStudents = leaderboardData.filter(s => s.tier === tier);
    if (tierStudents.length === 0) return;

    const canvas = document.createElement('canvas');
    const width = 950; // تكبير عرض اللوحة لإعطاء مساحة أكبر للأسماء الرباعية والألقاب
    const headerHeight = 240;
    const rowHeight = 85;
    const footerHeight = 160;
    canvas.width = width;
    canvas.height = headerHeight + (tierStudents.length * rowHeight) + footerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.direction = "rtl";

    // الخلفية بألوان تناسب كل قائمة
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (tier === 'gold') {
      gradient.addColorStop(0, '#fffdf0'); gradient.addColorStop(1, '#fef08a');
    } else if (tier === 'silver') {
      gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
    } else {
      gradient.addColorStop(0, '#fff7ed'); gradient.addColorStop(1, '#fed7aa');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // الإطار الخارجي المزدوج للفخامة
    ctx.strokeStyle = color;
    ctx.lineWidth = 14;
    ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(25, 25, canvas.width - 50, canvas.height - 50);

    // رأس اللوحة (العنوان)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // ظل ناعم للنصوص الرئيسية
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    
    ctx.fillStyle = color;
    ctx.font = '900 55px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`لوحة الشرف - ${title}`, width / 2, 90);
    
    ctx.shadowColor = 'transparent';

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 28px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`أوائل موسوعة الكنز التعليمي - أ/ إسلام سعود`, width / 2, 150);

    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG') + ' - ' + now.toLocaleTimeString('ar-EG');
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 18px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.fillText(`تاريخ الإصدار: ${dateStr}`, width / 2, 195);

    // رسم كروت الطلاب
    let y = headerHeight;
    tierStudents.forEach((st, idx) => {
      // كارت الطالب بخلفية بيضاء وزوايا دائرية وظل
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 5;
      
      if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(40, y, width - 80, rowHeight - 20, 15);
        ctx.fill();
      } else {
        ctx.fillRect(40, y, width - 80, rowHeight - 20);
      }
      ctx.shadowColor = 'transparent';

      const centerY = y + (rowHeight - 20) / 2;
      const centerX = width - 70;

      // رسم دائرة الترتيب
      ctx.beginPath();
      ctx.arc(centerX, centerY, 22, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // إضافة التاج المصغر فوق أرقام القائمة الذهبية فقط
      if (tier === 'gold') {
        ctx.font = '22px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑', centerX, centerY - 28);
      }

      // كتابة رقم الترتيب داخل الدائرة باللون الأبيض
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 22px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(toEasternArabic(idx + 1), centerX, centerY + 2);

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'right'; // إصلاح هام جداً: إعادة التوجيه لليمين بعد رسم التاج
      const fullName = st.name.split(' ').slice(0, 4).join(' '); // اسم رباعي
      // إضافة (500) كحد أقصى للعرض لضمان عدم خروج أي اسم مهما كان طويلاً عن الإطار
      ctx.fillText(fullName, width - 110, centerY, 500);

      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.font = '900 26px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.fillText(`${toEasternArabic(st.score)} نقطة`, 70, centerY);

      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 18px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
      ctx.fillText(`المتوسط: ${toEasternArabic(st.avg || 0)}%`, 250, centerY);

      y += rowHeight;
    });

    // تذييل اللوحة والكلمة التحفيزية
    ctx.textAlign = 'center';
    ctx.fillStyle = '#db2777';
    ctx.font = '900 32px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillText('هل ستنقلب الموازين ؟ في انتظار الجديد...', width / 2, y + 70);
    ctx.shadowColor = 'transparent';

    // تحميل الصورة
    const link = document.createElement('a');
    link.download = `لوحة_الشرف_${title.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  
  const calculateAdminLeaderboard = () => {
    const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
    const activeLessons = data.flatMap(u => u.lessons).filter(l => isLessonActive(l.id));
    const requiredCurrentTitles = activeLessons.map(l => l.title);

    const titleToQsMap: Record<string, number> = {};
    data.forEach(u => u.lessons.forEach(l => { titleToQsMap[l.title] = l.questions.length; }));

    const mapped = adminResults.map(student => {
      
      const firstScores: Record<string, number> = {};
      const firstAttemptIndices: Record<string, number> = {};
      
      // نفترض أن الاختبارات مرتبة زمنياً من الخادم
      student.tests.forEach(t => {
        if (isAmbiguousOldQuiz(t.quiz)) return;
        
        if (t.quiz.includes('تصفير') || String(t.score).includes('تصفير')) {
          if (t.quiz.includes('تصفير الوحدة')) { // تصفير وحدة
            const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
            const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
            if (unitToReset) {
                unitToReset.lessons.forEach(l => { delete firstScores[l.title]; delete firstAttemptIndices[l.title]; });
            }
          } else {
            for(let key in firstScores) delete firstScores[key];
            for(let key in firstAttemptIndices) delete firstAttemptIndices[key];
          }
          return;
        }
        const mappedTitle = matchQuizToCurrent(t.quiz, currentValidLessons);
        if (mappedTitle) {
              const sc = normalizeScore(t.score);
              if (firstScores[mappedTitle] === undefined) {
                firstScores[mappedTitle] = sc;
                firstAttemptIndices[mappedTitle] = (t as any).originalIndex || 0;
              }
        }
      });
      
      const uniqueQuizzes = Object.keys(firstScores);

      // شرط إتمام جميع الدروس المفعلة حالياً
      if (requiredCurrentTitles.length > 0 && !requiredCurrentTitles.every(reqTitle => uniqueQuizzes.includes(reqTitle))) {
        return null;
      }
  
      let totalXP = 0;
      let sumPerc = 0;
      uniqueQuizzes.forEach(q => {
         const perc = firstScores[q];
         sumPerc += perc;
         const tQs = titleToQsMap[q] || 0;
         totalXP += Math.round((perc / 100) * tQs) * 10;
      });
      
      let studentLatestTest = -1;
      uniqueQuizzes.forEach(q => {
         const attemptIndex = firstAttemptIndices[q];
         if (attemptIndex > studentLatestTest) studentLatestTest = attemptIndex;
      });
  
      const totalScore = totalXP;
      const testsCount = uniqueQuizzes.length;
      const avg = testsCount > 0 ? Math.min(100, Math.round(sumPerc / testsCount)) : 0;
  
      // شرط الاستبعاد الصارم: استبعاد من يقل معدله عن 80% نهائياً من أي قائمة
      if (avg < 80) {
        return null;
      }

      let trend = 'flat';
      if (testsCount > 1) {
        const lastQuiz = uniqueQuizzes[uniqueQuizzes.length - 1];
        const lastPerc = firstScores[lastQuiz];
        const prevPercSum = sumPerc - lastPerc;
        const prevAvg = Math.round(prevPercSum / (testsCount - 1));
        if (lastPerc > prevAvg + 2) trend = 'up';
        else if (lastPerc < prevAvg - 2) trend = 'down';
        else if (lastPerc === 100 && avg >= 95) trend = 'up';
      } else if (testsCount === 1) {
        if (avg >= 90) trend = 'up';
        else if (avg <= 75) trend = 'down';
      }
  
      return { name: student.name, phone: student.phone, score: totalScore, avg, testsCount, trend, latestTestOriginalIndex: studentLatestTest };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  
    const sorted = mapped.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.testsCount !== a.testsCount) {
        return b.testsCount - a.testsCount;
      }
      if (b.avg !== a.avg) {
        return b.avg - a.avg;
      }
      if (a.latestTestOriginalIndex !== b.latestTestOriginalIndex) {
        return a.latestTestOriginalIndex - b.latestTestOriginalIndex; // صاحب التوقيت الأقدم يكسب
      }
      return a.name.localeCompare(b.name, 'ar');
    });

    let goldCount = 0;
    let silverCount = 0;
    let bronzeCount = 0;

    const limitedSorted: {name: string, phone: string, score: number, avg: number, testsCount: number, tier: string, trend: string}[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      let tier = '';
      // القائمة الذهبية: بحد أقصى 10 طلاب، وبشرط معدل 90% فما فوق (المراكز 1 إلى 10)
      if (goldCount < 10 && s.avg >= 90) {
        tier = 'gold';
        goldCount++;
      } 
      // القائمة الفضية: بحد أقصى 10 طلاب (المراكز 11 إلى 20 أو الفائض من الذهبية) بمعدل 80% فما فوق
      else if (silverCount < 10) {
        tier = 'silver';
        silverCount++;
      } 
      // القائمة البرونزية: بحد أقصى 10 طلاب (المراكز 21 إلى 30) بمعدل 80% فما فوق
      else if (bronzeCount < 10) {
        tier = 'bronze';
        bronzeCount++;
      }
      if (tier) {
        limitedSorted.push({ ...s, tier, trend: s.trend });
      }
      if (goldCount + silverCount + bronzeCount >= 30) break;
    }
    return limitedSorted;
  };

  const adminLeaderboardList = useMemo(() => {
    if (adminActiveTab !== 'leaderboard') return [];
    return calculateAdminLeaderboard();
  }, [adminActiveTab, adminResults, data, publishedLessons]);

  const handleAdminCongratulateTier = (tier: 'gold' | 'silver' | 'bronze') => {
    const list = adminLeaderboardList.length > 0 ? adminLeaderboardList : calculateAdminLeaderboard();
    const tierTitle = tier === 'gold' ? 'القائمة الذهبية' : tier === 'silver' ? 'القائمة الفضية' : 'القائمة البرونزية';
    const studentsInTier = list.filter(s => s.tier === tier);
    if (studentsInTier.length === 0) {
        showAlert(`لا يوجد طلاب في ${tierTitle} لتهنئتهم.`);
        return;
    }

    const sortedStudents = studentsInTier.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.testsCount - a.testsCount;
    });

    const studentNames = sortedStudents
        .map((s, idx) => `${toEasternArabic(idx + 1)}. ${s.name.split(' ').slice(0, 4).join(' ')}`)
        .join('\n');

    const message = `🏆 تهانينا لأبطال ${tierTitle} في موسوعة الكنز! 🏆\n\nنفخر بكم وبمجهودكم الرائع:\n${studentNames}\n\nمع تمنياتنا بدوام التفوق والنجاح،\nأ/ إسلام سعود`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    showAlert(`جاري فتح واتساب مع رسالة التهنئة لـ ${tierTitle}.`);
  };

  const handleToggleLesson = (lessonId: string) => {
    setPublishedLessons(prev => {
      let currentList = prev;
      if (currentList.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') {
        currentList = data.flatMap(u => u.lessons.map(l => l.id));
      }
      const next = currentList.includes(lessonId) 
        ? currentList.filter(id => id !== lessonId) 
        : [...currentList, lessonId];
      localStorage.setItem('publishedLessons', JSON.stringify(next));
      localStorage.setItem('publishedLessons_init', 'true');
      return next;
    });
  };

  const handleToggleUnitAll = (unitId: string, publish: boolean) => {
    const targetUnit = data.find(u => u.id === unitId);
    if (!targetUnit) return;
    const unitLessonIds = targetUnit.lessons.map(l => l.id);
    setPublishedLessons(prev => {
      let currentList = prev;
      if (currentList.length === 0 && localStorage.getItem('publishedLessons_init') !== 'true') {
        currentList = data.flatMap(u => u.lessons.map(l => l.id));
      }
      let next: string[];
      if (publish) {
        next = Array.from(new Set([...currentList, ...unitLessonIds]));
      } else {
        next = currentList.filter(id => !unitLessonIds.includes(id));
      }
      localStorage.setItem('publishedLessons', JSON.stringify(next));
      localStorage.setItem('publishedLessons_init', 'true');
      return next;
    });
  };

  const handleSavePublishedLessons = async () => {
    setIsSavingLessons(true);
    try {
      localStorage.setItem('publishedLessons', JSON.stringify(publishedLessons));
      localStorage.setItem('publishedLessons_init', 'true');
      await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateSettings',
          fee: platformFee,
          announcement: announcement,
          timerMode: timerMode,
          timerUnitTarget: JSON.stringify(timerUnitTargets),
          timerSecondsPerQ: timerSecondsPerQ,
          publishedLessons: JSON.stringify(publishedLessons),
          apiKey: SECRET_API_KEY
        })
      });
      showAlert('تم حفظ وتحديث حالة نشر الدروس للطلاب بنجاح! 🚀');
    } catch(e) {
      showAlert('تم الحفظ في المتصفح بنجاح! (يرجى التأكد من اتصال الإنترنت لتحديث السيرفر)');
    }
    setIsSavingLessons(false);
  };

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}?action=getResults&apiKey=${SECRET_API_KEY}`); 
      const resData = await res.json();
      if(resData.status === 'success') {
        const grouped: Record<string, { phone: string; tests: TestResult[] }> = {};
        const chronologicalData = [...resData.data].reverse() as TestResult[];
        chronologicalData.forEach((r, idx) => {
          let correctName = r.name;
          const formattedPhone = formatPhoneStr(r.phone);
          const stRecord = studentsList[formattedPhone];

          if (stRecord) {
            const stArr = Array.isArray(stRecord) ? stRecord : [stRecord];
            const matchedStudent = stArr.find(s => s.name.trim() === r.name.trim());

            if (matchedStudent) {
              correctName = matchedStudent.name;
            } else {
              if (stArr.length === 1) {
                correctName = stArr[0].name;
              }
            }
          }

          if(!grouped[correctName]) grouped[correctName] = { phone: r.phone, tests: [] };
          grouped[correctName].tests.push({ ...r, originalIndex: idx } as any);
        });
        const sortedArray: GroupedResult[] = Object.keys(grouped)
          .sort((a,b)=>a.localeCompare(b, 'ar'))
          .map(k => ({ name: k, phone: grouped[k].phone, tests: grouped[k].tests }));
        setAdminResults(sortedArray);
      }
      const reqRes = await fetch(`${API_URL}?action=getPendingRequests&apiKey=${SECRET_API_KEY}`); 
      const reqData = await reqRes.json();
      if(reqData.status === 'success') {
        setAdminPendingReqs(reqData.data as PendingRequest[]);
      }
      try {
        const stdRes = await fetch(`${API_URL}?action=getAllStudents&apiKey=${SECRET_API_KEY}`);
        const stdData = await stdRes.json();
        if(stdData.status === 'success' && stdData.data) {
          setStudentsList(stdData.data);
        }
      } catch(e) {}
    } catch(e) { 
      showAlert('فشل الاتصال بقاعدة البيانات.'); 
    }
    setIsLoading(false);
  };

  const handleSyncDriveBackups = async () => {
    showConfirm('هل تريد بدء مزامنة اشتراكات مرحلة 2 بكالوريا (2 ثانوي) من مجلد Google Drive الآن؟', async () => {
      setIsSyncingDrive(true);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'syncDriveBackups',
            stage: 's2',
            folderId: '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM',
            apiKey: SECRET_API_KEY
          })
        });
        const res = await response.json();
        if (res.status === 'success') {
          showAlert(`✅ تمت المزامنة السحابية بنجاح!\n\n📄 الملف: ${res.fileName || 'أحدث ملف'}\n📅 تاريخ الباك آب: ${res.fileDate || ''}\n👥 إجمالي طلاب المرحلة بالنظام: ${res.totalTargetStudents || 0}\n✨ الطلاب المحدثة اشتراكاتهم: ${res.updatedCount || 0}\n➕ الطلاب الجدد المضافين: ${res.addedCount || 0}\n💳 إجمالي الشهور المسددة: ${res.monthsUpdatedCount || 0}`);
          fetchAdminData();
        } else {
          showAlert(`❌ فشلت المزامنة: ${res.message || 'حدث خطأ غير معروف'}`);
        }
      } catch (err: any) {
        showAlert(`❌ خطأ في الاتصال بالسيرفر: ${err.message || 'فشل الاتصال'}`);
      } finally {
        setIsSyncingDrive(false);
      }
    });
  };

  const handleSyncLocalBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsSyncingLocal(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (!parsed.students) {
          showAlert('❌ الملف غير صالح: لا يحتوي على بيانات طلاب.');
          setIsSyncingLocal(false);
          return;
        }

        // تصفية طلاب مرحلة s2 فقط لتقليل حجم البيانات المرسلة وسرعة المعالجة
        const s2Students = (parsed.students || []).filter((s: any) => String(s.stage || '').trim() === 's2');
        const s2StudentIds = new Set(s2Students.map((s: any) => String(s.id)));
        const s2Transactions = (parsed.transactions || []).filter((t: any) => s2StudentIds.has(String(t.sid)) || String(t.stage || '').trim() === 's2');

        const response = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'syncLocalBackup',
            stage: 's2',
            students: s2Students,
            transactions: s2Transactions,
            apiKey: SECRET_API_KEY
          })
        });
        const res = await response.json();
        if (res.status === 'success') {
          showAlert(`✅ تم تحديث الاشتراكات من الملف المحلي بنجاح!\n\n👥 إجمالي طلاب المرحلة بالملف: ${res.totalTargetStudents || s2Students.length}\n✨ الطلاب المحدثة اشتراكاتهم: ${res.updatedCount || 0}\n➕ الطلاب الجدد المضافين: ${res.addedCount || 0}\n💳 إجمالي الشهور المسددة: ${res.monthsUpdatedCount || 0}`);
          fetchAdminData();
        } else {
          showAlert(`❌ فشل التحديث: ${res.message || 'حدث خطأ غير معروف'}`);
        }
      } catch (err: any) {
        showAlert(`❌ خطأ أثناء معالجة الملف: ${err.message || 'ملف غير صالح'}`);
      } finally {
        setIsSyncingLocal(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadAdminCert = (studentName: string, unitTitle: string, unitPerc: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 700;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    ctx.direction = "rtl";
    const gradient = ctx.createLinearGradient(0, 0, 1000, 700);
    gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 700);
  
    ctx.strokeStyle = '#d97706'; ctx.lineWidth = 15; ctx.strokeRect(30, 30, 940, 640);
    ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 3; ctx.strokeRect(50, 50, 900, 600);
  
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    
    ctx.fillStyle = '#1e3a8a'; ctx.font = 'bold 70px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('شكر وتقدير', 500, 130);
    ctx.fillStyle = '#475569'; ctx.font = 'bold 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 230);
    ctx.fillStyle = '#d97706'; ctx.font = '900 55px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(studentName, 500, 320);
    ctx.fillStyle = '#475569'; ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`نظراً لمجهوده وتفانيه لإتمام (${unitTitle})`, 500, 400);
    ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`ببراعة وعبقرية بنسبة ${toEasternArabic(unitPerc)}%`, 500, 445);
    ctx.fillStyle = '#db2777'; ctx.font = '900 35px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أكمل يا بطلي فحقا فخور بك ❤️', 500, 510);
  
    ctx.beginPath(); ctx.moveTo(150, 560); ctx.lineTo(850, 560); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();
  
    ctx.fillStyle = '#0f172a'; ctx.font = '900 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أ/ إسلام سعود', 800, 610);
    ctx.fillStyle = '#16a34a'; ctx.font = '900 40px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`${toEasternArabic(unitPerc)}٪`, 500, 610);
    ctx.fillStyle = '#64748b'; ctx.font = 'bold 25px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('ar-EG'), 200, 610);
  
    const link = document.createElement('a');
    link.download = `شهادة_تفوق_${studentName.split(' ')[0]}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  
  const handleRegisterSubmit = async () => {
    if (!registerName || !registerMethod) { 
      showAlert('أدخل الاسم واختر طريقة الدفع.'); 
      return; 
    }
    const formattedPhone = formatPhoneStr(inputPhone); 
    const sheetPhone = '+20' + formattedPhone.substring(1);
    const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأود الاشتراك في منصة الكنز التعليمي\nالاسم: ${registerName}\nرقم الهاتف: ${inputPhone}\nالمرحلة: ${gradeName}\nقمت بالسداد من خلال: ${registerMethod}\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
    window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
    try { 
      fetch(API_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'requestSubscription', 
          date: new Date().toLocaleString('ar-EG'), 
          name: registerName, 
          phone: sheetPhone, 
          method: registerMethod, 
          apiKey: SECRET_API_KEY 
        }) 
      }); 
    } catch(e) {}
  };
  
  const handleActivateMonth = async (phone: string, name: string, month: string) => {
    showConfirm(`تفعيل شهر (${month}) للطالب: ${name}؟`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'activateSpecificMonth', 
            phone: phone, 
            month: month, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name 
                ? { 
                    ...s, 
                    missingMonths: s.missingMonths ? s.missingMonths.filter(m => m !== month) : [], 
                    isPaid: s.missingMonths ? s.missingMonths.length <= 1 : true 
                  } 
                : s
            );
          }
          return newList;
        });
        
        setTimeout(() => {
          showConfirm(`تم التفعيل بنجاح لـ ${name}!\nهل تحب إرسال رسالة تأكيد عبر الواتساب؟\n(تأكيد للإرسال، وإلغاء للتخطي)`, () => {
            const msg = `${name} : لقد تم تفعيلكم في منصة موسوعة الكنز\nتمنياتي بالتوفيق\n*أ/إسلام سعود*`;
            window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(msg)}`, '_blank');
          });
        }, 300);
      } catch(e) { 
        showAlert('حدث خطأ'); 
      }
    });
  };

  const handleResetDevice = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من فك ارتباط الجهاز للطالب: ${name}؟\nسيتمكن من الدخول من جهاز جديد.`, async () => {
      try {
        const res = await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'resetDevice', 
            phone: `${formatPhoneStr(phone)}_${name}`, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        const data = await res.json();
        if (data.status === 'success') {
          showAlert(`تم فك ارتباط الجهاز للطالب ${name} بنجاح! ✅\nيمكنه الآن تسجيل الدخول من جهازه الجديد.`);
        } else {
          showAlert(data.message || 'لم يتم العثور على جهاز مرتبط بهذا الطالب.');
        }
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };

  const handleBlockStudent = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من حظر الطالب: ${name}؟\nلن يتمكن من الدخول للمنصة بعد ذلك.`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'blockStudent', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name ? { ...s, isBlocked: true } as unknown as Student : s
            );
          }
          return newList;
        });
        showAlert(`تم حظر الطالب ${name} بنجاح! 🚫`);
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };

  const handleUnblockStudent = (phone: string, name: string) => {
    showConfirm(`هل أنت متأكد من فك الحظر عن الطالب: ${name}؟\nسيتمكن من الدخول للمنصة مرة أخرى.`, async () => {
      try {
        fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'unblockStudent', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        });
        setStudentsList(prev => {
          const newList = {...prev};
          if(newList[phone]) {
            const listArr = Array.isArray(newList[phone]) ? newList[phone] : [newList[phone]];
            newList[phone] = (listArr as Student[]).map(s => 
              s.name === name ? { ...s, isBlocked: false } as unknown as Student : s
            );
          }
          return newList;
        });
        
        setTimeout(() => {
          showConfirm(`تم فك الحظر عن الطالب ${name} بنجاح! ✅\nهل تحب إرسال رسالة تبشره بذلك عبر الواتساب؟`, () => {
            const msg = `أهلاً بك يا ${name} 🌟\nنبشرك بأنه قد تم فك الحظر عن حسابك، ويمكنك الآن الدخول لمنصة موسوعة الكنز التعليمي ومواصلة التدريب.\nتمنياتي لك بالتوفيق،\n*أ/إسلام سعود*`;
            window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(msg)}`, '_blank');
          });
        }, 300);
        
      } catch(e) { 
        showAlert('حدث خطأ أثناء الاتصال بالخادم.'); 
      }
    });
  };
  
    const formatWhatsAppPhone = (rawPhone: string) => {
    let p = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (p.startsWith('002')) p = p.substring(3);
    if (p.startsWith('20')) return p;
    if (p.startsWith('0')) return '20' + p.substring(1);
    return '20' + p;
  };

  const sendWhatsAppStudentWelcome = (phone: string, name: string, code: string, pkgType: string) => {
    const appLink = window.location.href.split('?')[0];
    const cleanP = formatWhatsAppPhone(phone);
    const welcomeMsg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nيسعدنا انضمامك معنا في منصة التاريخ (2 بكالوريا) للأستاذ / إسلام سعود ✨\n\nتم تفعيل اشتراكك بنجاح (${pkgType})، وبيانات دخولك هي:\n📱 رقم الهاتف المسجل: ${phone}\n🔑 كود الطالب: ${code}\n🌐 رابط المنصة: ${appLink}\n\nنتمنى لك رحلة تفوق مميزة والدرجة النهائية بإذن الله! 🌟`;
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(welcomeMsg)}`;
    const opened = window.open(waUrl, '_blank');
    if (!opened) {
      window.location.href = waUrl;
    }
  };

  const getOnlineSubscriptionStatus = (st: OnlineStudent) => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthIdx = today.getMonth(); // 0 = Jan, 9 = Oct
    const monthNamesMap: Record<number, string> = {
      8: "أغسطس", 9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
      1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل", 5: "مايو",
      6: "يونيو", 7: "يوليو"
    };
    const currentMonthName = monthNamesMap[currentMonthIdx + 1] || "أكتوبر";
    const activeMonthsStr = (st.activeMonths || '').replace(/،/g, ',');
    const activeMonthsArr = activeMonthsStr.split(',').map(m => m.trim()).filter(Boolean);

    if (st.packageType === 'سنة كاملة' || activeMonthsStr.includes('العام')) {
      return { status: 'active', label: 'ساري ونشط 🌟', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
    }

    const isCurrentActive = activeMonthsArr.includes(currentMonthName) || activeMonthsArr.some(m => m.includes(currentMonthName));

    if (!isCurrentActive) {
      return { status: 'expired', label: 'منتهي الصلاحية 🔴', color: 'bg-red-50 text-red-800 border-red-300' };
    }

    if (currentDay >= 20 || currentDay <= 5) {
      return { status: 'expiring', label: 'يوشك على الانتهاء ⏳', color: 'bg-amber-50 text-amber-900 border-amber-300' };
    }

    return { status: 'active', label: 'ساري ونشط 🟢', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
  };

  const sendWhatsAppRenewalReminder = (phone: string, name: string, pkgType: string) => {
    const cleanP = formatWhatsAppPhone(phone);
    const msg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nالأستاذ / إسلام سعود يحييك ويتمنى لك دوام التفوق والتميز ✨\n\nنود تذكيرك بأن اشتراكك الحالي (${pkgType}) يوشك على الانتهاء.\nلضمان استمرار فتح الامتحانات وبنك الأسئلة ومتابعة التدريبات دون توقف، يمكنك تجديد الاشتراك بسهولة عبر:\n📱 فودافون كاش / إنستاباي: 01228466613\n\nبعد التحويل، يرجى إرسال صورة التحويل ليتم تجديد تفعيل حسابك فوراً.\nبالتوفيق دائماً يا بطل والدرجة النهائية بإذن الله! 🌟`;
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(msg)}`;
    const opened = window.open(waUrl, '_blank');
    if (!opened) window.location.href = waUrl;
  };

  const handleCancelOnlineSubscription = (st: OnlineStudent) => {
    showConfirm(`هل أنت متأكد من إلغاء اشتراك الطالب: ${st.name}؟\nسيتم نقله إلى الأرشيف لحفظ الحقوق المالية وإيقاف دخوله للمنصة.`, async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'deleteOnlineStudent',
            phone: st.phone,
            name: st.name,
            reason: 'إلغاء اشتراك من لوحة الإدارة',
            apiKey: SECRET_API_KEY
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          setAdminOnlineStudents(prev => prev.filter(s => s.phone !== st.phone));
          showConfirm(`تم إلغاء اشتراك ${st.name} ونقله للأرشيف بنجاح! ✅\nهل ترغب في إرسال إشعار مهذب للطالب عبر واتساب؟`, () => {
            const cleanP = formatWhatsAppPhone(st.phone);
            const cancelMsg = `السلام عليكم يا ${st.name} 🎓\nنود إعلامك بأنه تم إيقاف أو انتهاء اشتراكك في موسوعة الكنز التعليمي.\nفي حال رغبتك في تجديد الاشتراك واستئناف التدريبات في أي وقت، يسعدنا تواصلك معنا دائماً.\nتمنياتنا لك بالتوفيق والنجاح،\nأ/ إسلام سعود ✨`;
            window.open(`https://api.whatsapp.com/send?phone=${cleanP}&text=${encodeURIComponent(cancelMsg)}`, '_blank');
          });
          setTimeout(fetchAdminData, 1500);
        } else {
          showAlert(data.message || 'حدث خطأ أثناء إلغاء الاشتراك.');
        }
      } catch(e) {
        showAlert('خطأ في الاتصال بالخادم.');
      }
    });
  };

  const generateOnlineCodeClient = (name: string, phone: string) => {
    const cleanP = formatPhoneStr(phone);
    const last4 = cleanP.length >= 4 ? cleanP.slice(-4) : ('0000' + cleanP).slice(-4);
    const mapChar: Record<string, string> = {
      'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A',
      'ب': 'B', 'ت': 'T', 'ث': 'T', 'ج': 'G', 'ح': 'H',
      'خ': 'K', 'د': 'D', 'ذ': 'Z', 'ر': 'R', 'ز': 'Z',
      'س': 'S', 'ش': 'S', 'ص': 'S', 'ض': 'D', 'ط': 'T',
      'ظ': 'Z', 'ع': 'A', 'غ': 'G', 'ف': 'F', 'ق': 'K',
      'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H',
      'ة': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'Y'
    };
    let firstLetter = 'A';
    if (name && name.trim().length > 0) {
      const rawFirst = name.trim().charAt(0);
      if (/[a-zA-Z]/.test(rawFirst)) {
        firstLetter = rawFirst.toUpperCase();
      } else if (mapChar[rawFirst]) {
        firstLetter = mapChar[rawFirst];
      }
    }
    return `${firstLetter}${last4}ESON`;
  };

  const handleOpenActivationModal = (req: PendingRequest) => {
    setSelectedActivationReq(req);
    setActivationPackage('شهري');
    setActivationMonth('أكتوبر');
    setActivationAmount('50');
  };

  const handleConfirmActivation = async () => {
    if (!selectedActivationReq) return;
    setIsActivatingOnline(true);
    const { name, phone, method } = selectedActivationReq;
    const generatedCode = generateOnlineCodeClient(name, phone);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'approveSubscription',
          phone: phone,
          name: name,
          method: method || 'تحويل',
          packageType: activationPackage,
          month: activationMonth,
          amount: activationAmount,
          stage: '2 بكالوريا',
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      const finalCode = data.studentCode || generatedCode;

      setAdminPendingReqs(prev => prev.filter(r => r.phone !== phone || r.name !== name));
      setSelectedActivationReq(null);
      const pkgLabel = activationPackage === 'شهري' ? `اشتراك شهر ${activationMonth}` : activationPackage;
      setActivationSuccess({
        code: finalCode,
        name: name,
        phone: phone,
        packageType: pkgLabel
      });
      // تحديث فوري للقائمة المحلية
      setAdminOnlineStudents(prev => {
        const filtered = prev.filter(s => s.phone !== phone);
        return [{
          code: finalCode,
          name: name,
          phone: phone,
          stage: '2 بكالوريا',
          packageType: pkgLabel,
          activeMonths: activationPackage === 'شهري' ? activationMonth : (activationPackage === 'سنة كاملة' ? 'العام كاملاً' : activationPackage),
          method: method || 'تحويل',
          amount: activationAmount,
          date: new Date().toLocaleDateString('ar-EG')
        }, ...filtered];
      });
      setTimeout(fetchAdminData, 1500);
    } catch(e) {
      showAlert('حدث خطأ أثناء الاتصال بالخادم.');
    }
    setIsActivatingOnline(false);
  };

  const handleManualAddOnline = async () => {
    if (!manualOnlineName.trim() || !manualOnlinePhone.trim()) {
      showAlert('يرجى إدخال اسم الطالب ورقم الهاتف.');
      return;
    }
    setIsActivatingOnline(true);
    const name = manualOnlineName.trim();
    const phone = manualOnlinePhone.trim();
    const generatedCode = generateOnlineCodeClient(name, phone);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'addOnlineStudentDirectly',
          phone: phone,
          name: name,
          method: manualOnlineMethod,
          packageType: activationPackage,
          month: activationMonth,
          amount: activationAmount,
          stage: '2 بكالوريا',
          apiKey: SECRET_API_KEY
        })
      });
      const data = await res.json();
      const finalCode = data.studentCode || generatedCode;

      setShowManualOnlineModal(false);
      setManualOnlineName('');
      setManualOnlinePhone('');
      setActivationSuccess({
        code: finalCode,
        name: name,
        phone: phone,
        packageType: activationPackage === 'شهري' ? `اشتراك شهر ${activationMonth}` : activationPackage
      });
      setTimeout(fetchAdminData, 2000);
    } catch(e) {
      showAlert('حدث خطأ أثناء إضافة الطالب.');
    }
    setIsActivatingOnline(false);
  };

  const handleApproveSubscription = async (phone: string, name: string) => {
    showConfirm(`تفعيل حساب: ${name}؟`, async () => {
      window.open(`https://wa.me/20${formatPhoneStr(phone).substring(1)}?text=${encodeURIComponent(`أهلاً بك ${name} تم التفعيل`)}`, '_blank');
      setAdminPendingReqs(prev => prev.filter(req => req.phone !== phone || req.name !== name));
      try { 
        await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'approveSubscription', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        }); 
        showAlert('تم التفعيل بنجاح وإضافة الطالب لجوجل شيت!'); 
        setTimeout(fetchAdminData, 2000);
      } catch(e) { 
        showAlert('خطأ في الاتصال بالخادم'); 
      }
    });
  };
  
  const handleRejectSubscription = async (phone: string, name: string) => {
    showConfirm(`رفض طلب: ${name}؟`, async () => {
      setAdminPendingReqs(prev => prev.filter(req => req.phone !== phone || req.name !== name));
      try { 
        await fetch(API_URL, { 
          method: 'POST', 
          body: JSON.stringify({ 
            action: 'rejectSubscription', 
            phone: phone, 
            name: name, 
            apiKey: SECRET_API_KEY 
          }) 
        }); 
        showAlert('تم الرفض وإزالة الطلب من جوجل شيت!'); 
        setTimeout(fetchAdminData, 2000);
      } catch(e) { 
        showAlert('خطأ في الاتصال بالخادم'); 
      }
    });
  };
  

const APPS_SCRIPT_OPTIMIZED_CODE = `// =========================================================================
// موسوعة الكنز التعليمي - Google Apps Script (المعدل والمتوافق مع الشيت الجديد)
// =========================================================================
// تعليمات النشر:
// 1. افتح ملف Google Sheets الخاص بك.
// 2. من القائمة العلوية اختر: الإضافات (Extensions) -> Apps Script.
// 3. احذف أي كود موجود هناك والصق هذا الكود بالكامل بدلاً منه.
// 4. اضغط على الزر الأزرق: نشر (Deploy) -> إدارة عمليات النشر (Manage Deployments) أو نشر جديد (New Deployment).
// 5. تأكد من ضبط: الوصول إلى (Who has access) -> الجميع (Anyone).
// =========================================================================

// مفتاح الأمان السري (يجب أن يكون متطابقاً مع الموجود في التطبيق)
var SECRET_API_KEY = "Kanz_Secret_2026_Secure";

function doGet(e) {
  try {
    // 🛡️ حارس الأمان: التحقق من مفتاح الـ API
    if (!e.parameter || e.parameter.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = e.parameter.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. جلب كل الطلاب والاشتراكات
    if (action === 'getAllStudents') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});
      
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var studentsMap = {};
      
      // الكشف الذكي عن الأعمدة بناءً على رؤوس الأعمدة
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var name = String(data[i][colMap.name] || "").trim();
        var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
        var status = colMap.status > -1 ? String(data[i][colMap.status] || "").trim() : "";
        var rawPhone = colMap.phone > -1 ? data[i][colMap.phone] : "";
        var phone = cleanPhone(rawPhone);
        
        if (!phone) continue;

        var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);

        // فحص حالة الحظر
        var isBlocked = false;
        if (colMap.block > -1) {
          var blockVal = String(data[i][colMap.block]).trim();
          if (blockVal === 'نعم' || blockVal === 'true') {
            isBlocked = true;
          }
        }

        if (!studentsMap[phone]) studentsMap[phone] = [];
        studentsMap[phone].push({
          name: name,
          code: studentCode,
          isPaid: payInfo.isPaid,
          missingMonths: payInfo.missingMonths,
          graceMonths: payInfo.graceMonths,
          graceDaysRemaining: payInfo.graceDaysRemaining,
          phone: phone,
          originalStatus: payInfo.originalStatus,
          isBlocked: isBlocked
        });
      }
      
      var settingsSheet = ss.getSheetByName("الإعدادات");
      var fee = "50 جنيهاً";
      var announcement = "";
      var timerMode, timerUnitTarget, timerSecondsPerQ;
      var publishedLessons = "";

      if (settingsSheet) {
         var settingsData = settingsSheet.getDataRange().getValues();
         if (settingsData.length > 1) {
             if (settingsData[1][0]) fee = settingsData[1][0];
             if (settingsData[1].length > 1 && settingsData[1][1]) announcement = settingsData[1][1];
             if (settingsData[1].length > 2 && settingsData[1][2]) timerMode = settingsData[1][2];
             if (settingsData[1].length > 3 && settingsData[1][3] !== undefined) timerUnitTarget = settingsData[1][3];
             if (settingsData[1].length > 4 && settingsData[1][4] !== undefined) timerSecondsPerQ = settingsData[1][4];
             if (settingsData[1].length > 5 && settingsData[1][5] !== undefined) publishedLessons = settingsData[1][5];
         }
      }

      return respondJSON({
        status: 'success', 
        data: studentsMap, 
        fee: fee, 
        announcement: announcement,
        timerMode: timerMode,
        timerUnitTarget: timerUnitTarget,
        timerSecondsPerQ: timerSecondsPerQ,
        publishedLessons: publishedLessons
      });
    }
    
    // 2. تسجيل الدخول
    else if (action === 'login') {
      var searchPhone = cleanPhone(e.parameter.phone);
      var studentsSheet = ss.getSheetByName("الطلاب");
      if (!studentsSheet) return respondJSON({status: 'error', message: 'شيت الطلاب غير موجود.'});

      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var foundStudents = [];
      var colMap = findColumnIndices(headers);
      
      for (var i = 1; i < data.length; i++) {
        var rowPhone = cleanPhone(data[i][colMap.phone]);
        
        if (rowPhone === searchPhone) {
          var name = String(data[i][colMap.name] || "").trim();
          var studentCode = colMap.code > -1 ? String(data[i][colMap.code] || "").trim() : "";
          var payInfo = calculateStudentPaymentStatus(headers, data[i], colMap);
          
          var isBlocked = false;
          if (colMap.block > -1) {
            var blockVal = String(data[i][colMap.block]).trim();
            if (blockVal === 'نعم' || blockVal === 'true') {
              isBlocked = true;
            }
          }
          
          foundStudents.push({
            name: name,
            code: studentCode,
            isPaid: payInfo.isPaid,
            missingMonths: payInfo.missingMonths,
            graceMonths: payInfo.graceMonths,
            graceDaysRemaining: payInfo.graceDaysRemaining,
            phone: searchPhone,
            originalStatus: payInfo.originalStatus,
            isBlocked: isBlocked
          });
        }
      }
      
      if (foundStudents.length > 0) {
        return respondJSON({status: 'success', student: foundStudents});
      } else {
        return respondJSON({status: 'error', message: 'الرقم غير مسجل لدينا.'});
      }
    }
    
    // 3. جلب النتائج
    else if (action === 'getResults') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) return respondJSON({status: 'success', data: []});
      
      var data = resultsSheet.getDataRange().getValues();
      var results = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0] && data[i][1]) {
           results.push({
             date: data[i][0],
             name: data[i][1],
             phone: data[i][2],
             quiz: data[i][3],
             score: data[i][4]
           });
        }
      }
      return respondJSON({status: 'success', data: results.reverse()});
    }

    // 4. جلب الطلبات المعلقة
    else if (action === 'getPendingRequests') {
      var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
      if (!reqSheet) return respondJSON({status: 'success', data: []});
      
      var data = reqSheet.getDataRange().getValues();
      var reqs = [];
      for (var i = 1; i < data.length; i++) {
        if(data[i][0]) reqs.push({ date: data[i][0], name: data[i][1], phone: data[i][2], method: data[i][3] });
      }
      return respondJSON({status: 'success', data: reqs});
    }

    // 5. جلب الأسئلة من جوجل شيت (والخرائط التفاعلية) مدمج مع نظام الكاش السريع 🚀
    else if (action === 'getQuestions') {
      var cache = CacheService.getScriptCache();
      var cachedData = cache.get('questionsData');
      if (cachedData) {
        return ContentService.createTextOutput(cachedData).setMimeType(ContentService.MimeType.JSON);
      }
      
      var qSheet = ss.getSheetByName("الأسئلة");
      if (!qSheet) return respondJSON({status: 'error', message: 'شيت "الأسئلة" غير موجود في ملف الإكسيل.'});
      
      var qData = qSheet.getDataRange().getValues();
      var questions = [];
      
      for (var i = 1; i < qData.length; i++) {
        if (qData[i][0] && qData[i][3]) { 
          questions.push({
            unit: String(qData[i][0]),
            section: String(qData[i][1]),
            type: String(qData[i][2] || 'mcq'),
            q: String(qData[i][3]),
            opt1: String(qData[i][4] || ''),
            opt2: String(qData[i][5] || ''),
            opt3: String(qData[i][6] || ''),
            opt4: String(qData[i][7] || ''),
            correct: String(qData[i][8] || ''),
            reason: String(qData[i][9] || ''),
            concept: String(qData[i][10] || ''),
            paragraph: String(qData[i][11] || ''), 
            audio: String(qData[i][12] || ''),     
            video: String(qData[i][13] || '')      
          });
        }
      }

      var mapsData = [];
      var mapsSheet = ss.getSheetByName("الخرائط");
      if (mapsSheet) {
         var mData = mapsSheet.getDataRange().getValues();
         for (var k = 1; k < mData.length; k++) {
            if (mData[k][0] && mData[k][1]) { 
               mapsData.push({
                  id: 'map_' + k,
                  title: String(mData[k][0]),
                  url: String(mData[k][1])
               });
            }
         }
      }
      
      var responseStr = JSON.stringify({status: 'success', data: questions, maps: mapsData});
      
      try { 
        cache.put('questionsData', responseStr, 600); 
      } catch(e) {}
      
      return ContentService.createTextOutput(responseStr).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 6. مزامنة الاشتراكات سحابياً من Google Drive عبر GET (للتشغيل التلقائي عبر Triggers أو الروابط المباشرة)
    else if (action === 'syncDriveBackups') {
      var stage = e.parameter.stage || 's2';
      var folderId = e.parameter.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
      var res = syncDriveBackupsCore(stage, folderId);
      return respondJSON(res);
    }
    
    return respondJSON({status: 'error', message: 'Unknown action'});

  } catch (err) {
    return respondJSON({status: 'error', message: err.message});
  }
}

// الدالة المسئولة عن حفظ وتعديل البيانات (Do Post) محصنة بنظام الطابور LockService
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    
    var payload = JSON.parse(e.postData.contents);
    if (payload.apiKey !== SECRET_API_KEY) {
      return respondJSON({status: 'error', message: 'Unauthorized Access'});
    }

    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === 'saveResult') {
      var resultsSheet = ss.getSheetByName("النتائج");
      if (!resultsSheet) {
        resultsSheet = ss.insertSheet("النتائج");
        resultsSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة"]);
      }
      resultsSheet.appendRow([payload.date, payload.name, payload.phone, payload.quiz, payload.score]);
      return respondJSON({status: 'success'});
    }
    
    // دالة حظر وفك حظر طالب واحد
    else if (action === 'blockStudent' || action === 'unblockStudent') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) {
          blockColIndex = headers.length;
          studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور");
       }
       
       var targetPhone = cleanPhone(payload.phone);
       var targetName = String(payload.name).trim();
       
       for (var i = 1; i < data.length; i++) {
           if (cleanPhone(data[i][colMap.phone]) === targetPhone && String(data[i][colMap.name]).trim() === targetName) {
               var val = action === 'blockStudent' ? 'نعم' : '';
               studentsSheet.getRange(i + 1, blockColIndex + 1).setValue(val);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error', message: 'لم يتم العثور على الطالب'});
    }

    // دالة الحظر الجماعي للطلاب غير المتفاعلين
    else if (action === 'blockMultipleStudents') {
       var studentsSheet = ss.getSheetByName("الطلاب");
       var data = studentsSheet.getDataRange().getValues();
       var headers = data[0];
       var colMap = findColumnIndices(headers);
       var blockColIndex = colMap.block;
       
       if (blockColIndex === -1) { 
           blockColIndex = headers.length; 
           studentsSheet.getRange(1, blockColIndex + 1).setValue("محظور"); 
       }
       var targetList = payload.students;
       for (var i = 1; i < data.length; i++) {
           var rPhone = cleanPhone(data[i][colMap.phone]);
           var rName = String(data[i][colMap.name]).trim();
           for (var j = 0; j < targetList.length; j++) {
               if (rPhone === cleanPhone(targetList[j].phone) && rName === String(targetList[j].name).trim()) {
                   studentsSheet.getRange(i + 1, blockColIndex + 1).setValue('نعم');
                   break;
               }
           }
       }
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'saveDeviceFingerprint') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (!devicesSheet) {
        devicesSheet = ss.insertSheet("الأجهزة");
        devicesSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
      }
      var data = devicesSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(payload.phone)) {
           if (String(data[i][1]) !== String(payload.fingerprint)) {
               return respondJSON({status: 'blocked', message: 'لقد سبق واستخدم هذا الرقم في متصفح أو جهاز آخر.'});
           }
           return respondJSON({status: 'success'});
        }
      }
      var now = new Date().toLocaleString("ar-EG", {timeZone: "Africa/Cairo"});
      devicesSheet.appendRow([payload.phone, payload.fingerprint, now]);
      return respondJSON({status: 'success'});
    }

    else if (action === 'resetDevice') {
      var devicesSheet = ss.getSheetByName("الأجهزة");
      if (devicesSheet) {
        var data = devicesSheet.getDataRange().getValues();
        var targetPhone = String(payload.phone);
        var deleted = false;
        for (var i = data.length - 1; i > 0; i--) {
          if (String(data[i][0]) === targetPhone) {
             devicesSheet.deleteRow(i + 1);
             deleted = true;
          }
        }
        if(deleted) return respondJSON({status: 'success'});
        return respondJSON({status: 'error', message: 'لا يوجد جهاز مرتبط بهذا الطالب.'});
      }
      return respondJSON({status: 'error', message: 'شيت الأجهزة غير موجود.'});
    }

    else if (action === 'requestSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       if (!reqSheet) {
          reqSheet = ss.insertSheet("طلبات التسجيل");
          reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع"]);
       }
       reqSheet.appendRow([payload.date, payload.name, payload.phone, payload.method]);
       return respondJSON({status: 'success'});
    }
    
    else if (action === 'approveSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       var data = reqSheet.getDataRange().getValues();
       var rowIndex = -1;
       for (var i = 1; i < data.length; i++) {
           if (String(data[i][2]).trim() === String(payload.phone).trim() && String(data[i][1]).trim() === String(payload.name).trim()) {
               rowIndex = i + 1; break;
           }
       }
       if (rowIndex > -1) {
           var studentsSheet = ss.getSheetByName("الطلاب");
           var headers = studentsSheet.getDataRange().getValues()[0];
           var colMap = findColumnIndices(headers);
           var newRow = new Array(headers.length).fill("مسدد");
           newRow[colMap.name] = payload.name;
           if (colMap.status > -1) newRow[colMap.status] = "منتظم";
           newRow[colMap.phone] = payload.phone;
           studentsSheet.appendRow(newRow);
           reqSheet.deleteRow(rowIndex);
           return respondJSON({status: 'success'});
       }
       return respondJSON({status: 'error'});
    }

    else if (action === 'rejectSubscription') {
       var reqSheet = (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
       var data = reqSheet.getDataRange().getValues();
       for (var i = 1; i < data.length; i++) {
           if (String(data[i][2]).trim() === String(payload.phone).trim() && String(data[i][1]).trim() === String(payload.name).trim()) {
               reqSheet.deleteRow(i + 1);
               return respondJSON({status: 'success'});
           }
       }
       return respondJSON({status: 'error'});
    }

    else if (action === 'activateSpecificMonth') {
      var studentsSheet = ss.getSheetByName("الطلاب");
      var data = studentsSheet.getDataRange().getValues();
      var headers = data[0];
      var colMap = findColumnIndices(headers);
      var targetPhone = cleanPhone(payload.phone);
      var monthIndex = headers.indexOf(payload.month);
      
      if (monthIndex > -1) {
          var paymentDateString = "تم التفعيل " + new Date().toLocaleDateString('ar-EG', { timeZone: "Africa/Cairo" });
          for (var i = 1; i < data.length; i++) {
            if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
               studentsSheet.getRange(i + 1, monthIndex + 1).setValue(paymentDateString);
               return respondJSON({status: 'success'});
            }
          }
      }
      return respondJSON({status: 'error'});
    }
    
    else if (action === 'updateSettings') {
       var settingsSheet = ss.getSheetByName("الإعدادات");
       if (!settingsSheet) {
          settingsSheet = ss.insertSheet("الإعدادات");
          settingsSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
       }
       var headers = settingsSheet.getDataRange().getValues()[0];
       if (headers.indexOf("الإشعار") === -1) settingsSheet.getRange(1, 2).setValue("الإشعار");
       if (headers.indexOf("إعدادات العداد") === -1) settingsSheet.getRange(1, 3).setValue("إعدادات العداد");
       if (headers.indexOf("الوحدة المستهدفة") === -1) settingsSheet.getRange(1, 4).setValue("الوحدة المستهدفة");
       if (headers.indexOf("وقت السؤال") === -1) settingsSheet.getRange(1, 5).setValue("وقت السؤال");
       if (headers.indexOf("الدروس المنشورة") === -1) settingsSheet.getRange(1, 6).setValue("الدروس المنشورة");

       settingsSheet.getRange(2, 1).setValue(payload.fee);
       settingsSheet.getRange(2, 2).setValue(payload.announcement || "");
       
       if (payload.timerMode !== undefined) settingsSheet.getRange(2, 3).setValue(payload.timerMode);
       if (payload.timerUnitTarget !== undefined) settingsSheet.getRange(2, 4).setValue(payload.timerUnitTarget);
       if (payload.timerSecondsPerQ !== undefined) settingsSheet.getRange(2, 5).setValue(payload.timerSecondsPerQ);
       if (payload.publishedLessons !== undefined) settingsSheet.getRange(2, 6).setValue(payload.publishedLessons);
        
        return respondJSON({status: 'success'});
     }

     // 7. مزامنة الاشتراكات سحابياً من Google Drive عبر POST
     else if (action === 'syncDriveBackups') {
       var stage = payload.stage || 's2';
       var folderId = payload.folderId || '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM';
       var res = syncDriveBackupsCore(stage, folderId);
       return respondJSON(res);
     }

     // 8. مزامنة الاشتراكات محلياً عبر رفع ملف JSON
     else if (action === 'syncLocalBackup') {
       var stage = payload.stage || 's2';
       var res = applyBackupToSheet(payload.students, payload.transactions, stage);
       return respondJSON(res);
     }

  } catch (error) {
    return respondJSON({status: 'error', message: error.message});
  } finally {
    lock.releaseLock();
  }
}

// دالة ذكية لاكتشاف مواقع الأعمدة تلقائياً سواء كان الشيت القديم أو الجديد
function findColumnIndices(headers) {
  var nameCol = -1, codeCol = -1, statusCol = -1, phoneCol = -1, blockCol = -1, stageCol = -1, genderCol = -1;
  var nonMonthCols = [];

  for (var h = 0; h < headers.length; h++) {
    var hStr = String(headers[h]).trim();
    if (hStr === "الاسم" || hStr === "اسم الطالب") {
      nameCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "كود الطالب" || hStr === "الكود" || hStr === "كود") {
      codeCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "الحالة المالية" || hStr === "الحالة") {
      statusCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "الهاتف" || hStr === "رقم الهاتف" || hStr === "الموبايل") {
      phoneCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "محظور" || hStr === "الحظر") {
      blockCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "المرحلة" || hStr === "الصف") {
      stageCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "النوع" || hStr === "الجنس") {
      genderCol = h;
      nonMonthCols.push(h);
    } else if (hStr === "ملاحظات" || hStr === "أغسطس") {
      nonMonthCols.push(h);
    }
  }

  // قيم افتراضية ذكية:
  if (nameCol === -1) { nameCol = 0; nonMonthCols.push(0); }
  if (codeCol === -1) { codeCol = 1; nonMonthCols.push(1); }
  if (statusCol === -1) { statusCol = 2; nonMonthCols.push(2); }
  if (phoneCol === -1) { 
    phoneCol = (headers.length > 5 ? 5 : 3); 
    nonMonthCols.push(phoneCol); 
  }

  return {
    name: nameCol,
    code: codeCol,
    status: statusCol,
    phone: phoneCol,
    block: blockCol,
    stage: stageCol,
    gender: genderCol,
    nonMonthCols: nonMonthCols
  };
}

// دالة حساب المتأخرات وفترة السماح الذكية (حتى يوم 5) مع مراعاة الإعفاء وتجاهل أغسطس
function calculateStudentPaymentStatus(headers, rowData, colMap) {
  var status = colMap.status > -1 ? String(rowData[colMap.status] || "").trim() : "";
  var isExempt = (status.indexOf('معفي') > -1 || status.indexOf('معفى') > -1);

  if (isExempt) {
    return {
      isPaid: true,
      missingMonths: [],
      graceMonths: [],
      graceDaysRemaining: 0,
      originalStatus: "معفي"
    };
  }

  var now = new Date();
  var currentDay = parseInt(Utilities.formatDate(now, "Africa/Cairo", "d"), 10);
  var currentMonth = parseInt(Utilities.formatDate(now, "Africa/Cairo", "M"), 10);

  var MONTH_MAP = {
    "سبتمبر": 9, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12, "يناير": 1,
    "فبراير": 2, "مارس": 3, "أبريل": 4, "مايو": 5
  };

  var toAcademicIndex = function(m) {
    return m >= 9 ? (m - 8) : (m + 4);
  };

  var acadCurrent = toAcademicIndex(currentMonth);
  var hardOverdueMonths = [];
  var graceMonths = [];

  for (var j = 0; j < headers.length; j++) {
    if (colMap.nonMonthCols.indexOf(j) > -1) continue;

    var headerName = String(headers[j] || "").trim();
    if (headerName === "أغسطس") continue;

    var targetMonthNum = MONTH_MAP[headerName];
    if (!targetMonthNum) continue;

    var acadTarget = toAcademicIndex(targetMonthNum);

    var cellValue = String(rowData[j] || "").trim();
    var isCellPaid = (cellValue !== "" && cellValue !== "-" && cellValue !== "لا" && cellValue.indexOf("متأخر") === -1);

    if (!isCellPaid) {
      if (acadTarget > acadCurrent) {
        // شهر قادم: لم يحن وقته
      } else if (acadTarget === acadCurrent) {
        // الشهر الحالي (مثلاً أكتوبر ونحن في أكتوبر): لم ينتهِ بعد
      } else if (acadTarget === acadCurrent - 1) {
        // الشهر السابق مباشرة (مثلاً سبتمبر ونحن في أكتوبر):
        // من يوم 1 إلى 4: فترة سماح وتذكير ودي
        // من يوم 5 فصاعداً: متأخر تماماً ويستوجب الإيقاف
        if (currentDay >= 5) {
          hardOverdueMonths.push(headerName);
        } else {
          graceMonths.push(headerName);
        }
      } else {
        // شهر سابق بأكثر من شهر وما زال غير مسدد: متأخر تماماً
        hardOverdueMonths.push(headerName);
      }
    }
  }

  var isPaid = (hardOverdueMonths.length === 0);
  var graceDaysRemaining = Math.max(0, 5 - currentDay);

  return {
    isPaid: isPaid,
    missingMonths: hardOverdueMonths,
    graceMonths: graceMonths,
    graceDaysRemaining: graceDaysRemaining,
    originalStatus: status
  };
}

// دالة مساعدة لإرجاع البيانات بتنسيق JSON نظيف
function respondJSON(responseObject) {
  return ContentService.createTextOutput(JSON.stringify(responseObject)).setMimeType(ContentService.MimeType.JSON);
}

// دالة تنظيف أرقام الهواتف (تحويل الأرقام العربية إلى إنجليزية وإزالة المسافات والعلامات)

// دالة توحيد الحروف العربية لمطابقة الأسماء بدقة
function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhone(phone) {
  if (!phone) return "";
  var str = String(phone);
  var arabicNumbers = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  for(var i=0; i<10; i++) {
    var regex = new RegExp(arabicNumbers[i], 'g');
    str = str.replace(regex, i);
  }
  str = str.replace(/[\s\+\.\-]/g, '');
  if (str.startsWith('20') && str.length > 10) {
    str = str.substring(2);
  }
  if ((str.length === 10 || str.length === 9) && str.startsWith('1')) {
    str = '0' + str;
  }
  return str;
}


// =========================================================================
// وظائف المزامنة الذكية مع Google Drive والنسخ الاحتياطية لتطبيق السنتر
// =========================================================================

// قائمة مخصصة تظهر في شريط قوائم جوجل شيت بالأعلى للتشغيل اليدوي المباشر
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ موسوعة الكنز')
    .addItem('🛠️ تهيئة وإنشاء كافة صفحات الشيت تلقائياً (Setup)', 'initAllSheetsMenu')
    .addSeparator()
    .addItem('🔄 مزامنة الاشتراكات من Google Drive (2 ثانوي)', 'syncDriveBackupsMenu')
    .addToUi();
}

function syncDriveBackupsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = syncDriveBackupsCore('s2', '1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM');
  if (res.status === 'success') {
    ui.alert(
      '✅ تمت المزامنة بنجاح!',
      'الملف المستخدم: ' + res.fileName + '\n' +
      'تاريخ الباك آب: ' + res.fileDate + '\n' +
      'إجمالي طلاب المرحلة بالنظام: ' + res.totalTargetStudents + '\n' +
      'الطلاب المحدثة اشتراكاتهم: ' + res.updatedCount + '\n' +
      'الطلاب الجدد المضافين: ' + res.addedCount + '\n' +
      'إجمالي الشهور المسددة المحدثة: ' + res.monthsUpdatedCount,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('❌ خطأ في المزامنة', res.message, ui.ButtonSet.OK);
  }
}

// الدالة الأساسية لقراءة أحدث ملف باك آب من مجلد درايف
function syncDriveBackupsCore(targetStage, folderId) {
  var stage = targetStage || 's2';
  var targetFolder = null;
  var candidateIds = [
    folderId,
    "1n9QfJDscZ-I4Ulymls0aqQM_7ULxGjVM",
    "1n9QfJDscZ-l4Ulymls0aqQM_7ULxGjVM", // تجربة l الصغيرة بدلاً من I الكبيرة
    "1n9QfJDscZ-14Ulymls0aqQM_7ULxGjVM", // تجربة رقم 1
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5l9NQ",
    "1RxUSNgaBGqBf9w9kK5owfY8ftD5I9NQ"
  ];

  // 1. المحاولة الأولى: فتح المجلد بأحد المعرّفات المحتملة
  for (var i = 0; i < candidateIds.length; i++) {
    if (!candidateIds[i]) continue;
    try {
      targetFolder = DriveApp.getFolderById(candidateIds[i]);
      if (targetFolder) break;
    } catch (e) {}
  }

  // 2. المحاولة الثانية: البحث بالاسم عن مجلد System_Backups
  if (!targetFolder) {
    try {
      var fldrs = DriveApp.getFoldersByName("System_Backups");
      if (fldrs.hasNext()) targetFolder = fldrs.next();
    } catch(e) {}
  }

  // 3. المحاولة الثالثة: البحث بالاسم عن مجلد "نسخة التطبيق الاحتياطية"
  if (!targetFolder) {
    try {
      var pFldrs = DriveApp.getFoldersByName("نسخة التطبيق الاحتياطية");
      if (pFldrs.hasNext()) {
        var parentF = pFldrs.next();
        var subF = parentF.getFoldersByName("System_Backups");
        if (subF.hasNext()) targetFolder = subF.next();
        else targetFolder = parentF;
      }
    } catch(e) {}
  }

  var latestFile = null;
  var latestDate = 0;

  // إذا تم العثور على المجلد، نبحث عن أحدث ملف JSON بداخله
  if (targetFolder) {
    try {
      var files = targetFolder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var fName = f.getName().toLowerCase();
        if (fName.indexOf('.json') > -1) {
          var updated = f.getLastUpdated().getTime();
          if (updated > latestDate) {
            latestDate = updated;
            latestFile = f;
          }
        }
      }
    } catch(e) {}
  }

  // 4. المحاولة الرابعة: إذا لم يتم العثور على المجلد، نبحث مباشرة عن ملفات الباك آب في درايف كله
  if (!latestFile) {
    try {
      var allJsonFiles = DriveApp.searchFiles('title contains ".json" and trashed = false');
      while (allJsonFiles.hasNext()) {
        var jf = allJsonFiles.next();
        var jName = jf.getName().toLowerCase();
        if (jName.indexOf('backup_') > -1 || jName === 'emergency_autosave.json') {
          var uDate = jf.getLastUpdated().getTime();
          if (uDate > latestDate) {
            latestDate = uDate;
            latestFile = jf;
          }
        }
      }
    } catch(e) {}
  }

  // 5. المحاولة الخامسة: البحث المباشر بالاسم عن emergency_autosave.json
  if (!latestFile) {
    try {
      var autoFiles = DriveApp.getFilesByName("emergency_autosave.json");
      if (autoFiles.hasNext()) latestFile = autoFiles.next();
    } catch(e) {}
  }

  if (!latestFile) {
    return { 
      status: 'error', 
      message: 'لم يتم العثور على ملفات الباك آب في حساب Google Drive الحالي.\n\n💡 تأكد من الآتي:\n1. إذا كان شيت المنصة على إيميل جوجل مختلف عن إيميل الباك آب، يرجى فتح جوجل درايف وعمل مشاركة (Share) لمجلد System_Backups مع إيميل هذا الشيت.\n2. أو يمكنك استخدام زر (رفع ملف الباك آب JSON محلياً) من لوحة إدارة المنصة لتحديث الشيت فوراً.' 
    };
  }

  var content = latestFile.getBlob().getDataAsString('UTF-8');
  var parsedData;
  try {
    parsedData = JSON.parse(content);
  } catch(e) {
    return { status: 'error', message: 'خطأ في قراءة ملف JSON: ' + e.message };
  }

  var res = applyBackupToSheet(parsedData.students, parsedData.transactions, stage);
  if (res.status === 'success') {
    res.fileName = latestFile.getName();
    res.fileDate = latestFile.getLastUpdated().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
  }
  return res;
}

// تطبيق بيانات الطلاب والمعاملات المالية على شيت الطلاب
function applyBackupToSheet(students, transactions, targetStage) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var studentsSheet = ss.getSheetByName('الطلاب');
  if (!studentsSheet) {
    initAllSheets();
    studentsSheet = ss.getSheetByName('الطلاب');
  }

  var stageCode = String(targetStage || 's2').trim();
  
  // 1. تصفية طلاب المرحلة المستهدفة
  var targetStudents = (students || []).filter(function(st) {
    return String(st.stage || '').trim() === stageCode;
  });

  if (targetStudents.length === 0) {
    return { status: 'error', message: 'لم يتم العثور على أي طلاب للمرحلة: ' + stageCode };
  }

  // 2. تجميع الشهور المسددة حصراً من المعاملات الفعلية (transactions)
  // تم إلغاء exemptMonths تماماً لأنها تخص تخفيضات الإخوة في تطبيق السنتر وليست شهوراً مسددة
  var paidMonthsMap = {};
  (transactions || []).forEach(function(tx) {
    if (tx.sid && tx.month) {
      var sid = String(tx.sid).trim();
      if (!paidMonthsMap[sid]) paidMonthsMap[sid] = {};
      var m = String(tx.month).trim();
      if (m) paidMonthsMap[sid][m] = true;
    }
  });

  // 3. تجهيز بيانات طلاب الباك آب مع فهرسة ثلاثية (بالكود والهاتف والاسم)
  var backupList = [];
  var backupByCode = {};
  var backupByPhone = {};
  var backupByName = {};

  targetStudents.forEach(function(st) {
    var p = cleanPhone(st.phone);
    var code = String(st.studentCode || '').trim();
    var name = String(st.name || '').trim();
    var normName = normalizeName(name);

    var isExempt = (st.isFullyExempt === true);
    var sMonths = paidMonthsMap[String(st.id).trim()] ? Object.keys(paidMonthsMap[String(st.id).trim()]) : [];

    var bObj = {
      id: String(st.id || '').trim(),
      name: name,
      normName: normName,
      phone: p,
      studentCode: code,
      exempt: isExempt,
      paidMonths: sMonths,
      gender: (st.gender === 'boys' ? 'بنين' : (st.gender === 'girls' ? 'بنات' : '')),
      stage: '2 ثانوي'
    };

    backupList.push(bObj);
    if (code) backupByCode[code] = bObj;
    if (p) backupByPhone[p] = bObj;
    if (normName) backupByName[normName] = bObj;
  });

  // 4. قراءة بيانات شيت الطلاب الحالية
  var sheetData = studentsSheet.getDataRange().getValues();
  var headers = sheetData[0];
  var colMap = findColumnIndices(headers);

  // خريطة أعمدة الشهور في الشيت
  var monthColIndices = {};
  for (var c = 0; c < headers.length; c++) {
    var hName = String(headers[c] || '').trim();
    if (colMap.nonMonthCols.indexOf(c) === -1 || hName === 'أغسطس' || hName === 'سبتمبر' || hName === 'أكتوبر' || hName === 'نوفمبر' || hName === 'ديسمبر' || hName === 'يناير' || hName === 'فبراير' || hName === 'مارس' || hName === 'أبريل' || hName === 'مايو') {
      monthColIndices[hName] = c;
    }
  }

  var updatedCount = 0;
  var monthsUpdatedCount = 0;
  var matchedBackupIds = {};
  var seenSheetKeys = {}; // لتتبع وحذف الصفوف المكررة في الشيت
  var rowsToDelete = [];

  // 5. التحديث والفحص الذكي لجميع صفوف الشيت الحالية + تنظيف التكرارات
  for (var r = 1; r < sheetData.length; r++) {
    var rowCode = colMap.code > -1 ? String(sheetData[r][colMap.code] || '').trim() : '';
    var rowPhone = colMap.phone > -1 ? cleanPhone(sheetData[r][colMap.phone]) : '';
    var rowName = colMap.name > -1 ? String(sheetData[r][colMap.name] || '').trim() : '';
    var rowNormName = normalizeName(rowName);

    // التحقق من التكرار داخل الشيت: إذا تكرر نفس الكود أو الهاتف أو الاسم
    var rowKey = rowCode || rowPhone || rowNormName;
    if (rowKey && seenSheetKeys[rowKey]) {
      // صف مكرر! يتم إضافته لقائمة الحذف
      rowsToDelete.push(r + 1);
      continue;
    }
    if (rowKey) seenSheetKeys[rowKey] = true;

    // مطابقة الطالب: نبحث بالكود أولاً، ثم بالهاتف، ثم بالاسم
    var bStudent = null;
    if (rowCode && backupByCode[rowCode]) bStudent = backupByCode[rowCode];
    else if (rowPhone && backupByPhone[rowPhone]) bStudent = backupByPhone[rowPhone];
    else if (rowNormName && backupByName[rowNormName]) bStudent = backupByName[rowNormName];

    if (!bStudent) continue;

    matchedBackupIds[bStudent.id] = true;
    var studentRowChanged = false;

    // تحديث وتثبيت الهاتف كـ نص صريح مع الصفر إن لم يكن كذلك
    if (colMap.phone > -1 && bStudent.phone) {
      var currentPhoneVal = String(sheetData[r][colMap.phone] || '').trim();
      var desiredPhoneStr = bStudent.phone.startsWith('0') ? bStudent.phone : ('0' + bStudent.phone);
      if (currentPhoneVal !== desiredPhoneStr && cleanPhone(currentPhoneVal) === bStudent.phone) {
        studentsSheet.getRange(r + 1, colMap.phone + 1).setValue("'" + desiredPhoneStr);
      }
    }

    // تحديث الحالة المالية بدقة: معفي فقط لمن لديه إعفاء كلي، ومنتظم للباقين
    if (colMap.status > -1) {
      var curStatus = String(sheetData[r][colMap.status] || '').trim();
      var correctStatus = bStudent.exempt ? 'معفي' : 'منتظم';
      if (curStatus !== correctStatus) {
        studentsSheet.getRange(r + 1, colMap.status + 1).setValue(correctStatus);
        studentRowChanged = true;
      }
    }

    // تحديث المرحلة والنوع إن وجد عمودهما وكان فارغاً
    if (colMap.stage > -1 && !sheetData[r][colMap.stage]) {
      studentsSheet.getRange(r + 1, colMap.stage + 1).setValue(bStudent.stage);
    }
    if (colMap.gender > -1 && !sheetData[r][colMap.gender] && bStudent.gender) {
      studentsSheet.getRange(r + 1, colMap.gender + 1).setValue(bStudent.gender);
    }

    // تحديث الشهور المسددة الفعلية فقط من واقع transactions
    bStudent.paidMonths.forEach(function(mName) {
      var colIdx = monthColIndices[mName];
      if (colIdx !== undefined) {
        var curVal = String(sheetData[r][colIdx] || '').trim();
        if (!curVal || curVal === '-' || curVal === 'لا' || curVal.indexOf('متأخر') > -1) {
          studentsSheet.getRange(r + 1, colIdx + 1).setValue('مسدد');
          studentRowChanged = true;
          monthsUpdatedCount++;
        }
      }
    });

    if (studentRowChanged) {
      updatedCount++;
    }
  }

  // حذف الصفوف المكررة من الأسفل إلى الأعلى للحفاظ على ترتيب المؤشرات
  if (rowsToDelete.length > 0) {
    for (var d = rowsToDelete.length - 1; d >= 0; d--) {
      studentsSheet.deleteRow(rowsToDelete[d]);
    }
  }

  // 6. إضافة الطلاب الجدد غير المسجلين نهائياً (فقط إذا لم يكن له كود أو هاتف أو اسم مسجل)
  var addedCount = 0;
  backupList.forEach(function(newSt) {
    if (!matchedBackupIds[newSt.id]) {
      var isAlreadyInSheet = (newSt.studentCode && seenSheetKeys[newSt.studentCode]) ||
                             (newSt.phone && seenSheetKeys[newSt.phone]) ||
                             (newSt.normName && seenSheetKeys[newSt.normName]);
      if (isAlreadyInSheet) return;

      var newRow = new Array(headers.length).fill('');
      newRow[colMap.name] = newSt.name;
      var formattedPhoneStr = newSt.phone.startsWith('0') ? newSt.phone : ('0' + newSt.phone);
      newRow[colMap.phone] = "'" + formattedPhoneStr;
      
      if (colMap.code > -1 && newSt.studentCode) newRow[colMap.code] = newSt.studentCode;
      if (colMap.status > -1) newRow[colMap.status] = newSt.exempt ? 'معفي' : 'منتظم';
      if (colMap.stage > -1) newRow[colMap.stage] = newSt.stage;
      if (colMap.gender > -1) newRow[colMap.gender] = newSt.gender;

      newSt.paidMonths.forEach(function(mName) {
        var colIdx = monthColIndices[mName];
        if (colIdx !== undefined) {
          newRow[colIdx] = 'مسدد';
          monthsUpdatedCount++;
        }
      });

      studentsSheet.appendRow(newRow);
      addedCount++;
      matchedBackupIds[newSt.id] = true;
      if (newSt.studentCode) seenSheetKeys[newSt.studentCode] = true;
      if (newSt.phone) seenSheetKeys[newSt.phone] = true;
      if (newSt.normName) seenSheetKeys[newSt.normName] = true;
    }
  });

  return {
    status: 'success',
    updatedCount: updatedCount,
    addedCount: addedCount,
    cleanedDuplicates: rowsToDelete.length,
    monthsUpdatedCount: monthsUpdatedCount,
    totalTargetStudents: targetStudents.length
  };
}


// =========================================================================
// وظيفة التهيئة الشاملة: إنشاء كل صفحات وأعمدة الشيت تلقائياً بضغطة زر واحدة
// =========================================================================
function initAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. شيت الطلاب (مطابق 100% لهيكل الشيت القديم)
  var sSheet = ss.getSheetByName("الطلاب");
  if (!sSheet) {
    sSheet = ss.insertSheet("الطلاب");
    sSheet.appendRow([
      "الاسم", "كود الطالب", "الحالة المالية", "المرحلة", "النوع", "الهاتف",
      "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو",
      "محظور"
    ]);
    sSheet.getRange(1, 1, 1, 17).setBackground("#1e3a8a").setFontColor("#ffffff").setFontWeight("bold");
    sSheet.setFrozenRows(1);
    // ضبط عمود الهاتف كـ نص صريح لمنع اختفاء الصفر
    sSheet.getRange("F:F").setNumberFormat("@");
  }

  // 2. شيت الأسئلة
  var qSheet = ss.getSheetByName("الأسئلة");
  if (!qSheet) {
    qSheet = ss.insertSheet("الأسئلة");
    qSheet.appendRow([
      "الوحدة", "الدرس", "النوع", "السؤال",
      "الاختيار 1", "الاختيار 2", "الاختيار 3", "الاختيار 4",
      "الإجابة الصحيحة", "التفسير", "المفهوم", "الفقرة", "الصوت", "الفيديو"
    ]);
    qSheet.getRange(1, 1, 1, 14).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    qSheet.setFrozenRows(1);
  }

  // 3. شيت النتائج
  var rSheet = ss.getSheetByName("النتائج");
  if (!rSheet) {
    rSheet = ss.insertSheet("النتائج");
    rSheet.appendRow(["التاريخ والوقت", "اسم الطالب", "رقم الهاتف", "الاختبار / الدرس", "النتيجة"]);
    rSheet.getRange(1, 1, 1, 5).setBackground("#b45309").setFontColor("#ffffff").setFontWeight("bold");
    rSheet.setFrozenRows(1);
  }

  // 4. شيت الإعدادات
  var setSheet = ss.getSheetByName("الإعدادات");
  if (!setSheet) {
    setSheet = ss.insertSheet("الإعدادات");
    setSheet.appendRow(["قيمة الاشتراك", "الإشعار", "إعدادات العداد", "الوحدة المستهدفة", "وقت السؤال", "الدروس المنشورة"]);
    setSheet.appendRow(["50 جنيهاً", "مرحباً بكم في منصة الكنز التعليمي", "disabled", "[]", 60, "[]"]);
    setSheet.getRange(1, 1, 1, 6).setBackground("#475569").setFontColor("#ffffff").setFontWeight("bold");
    setSheet.setFrozenRows(1);
  }

  // 5. شيت طلبات الاشتراك
  var reqSheet = ss.getSheetByName("طلبات_الاشتراك") || (ss.getSheetByName("طلبات_الاشتراك") || ss.getSheetByName("طلبات التسجيل"));
  if (!reqSheet) {
    reqSheet = ss.insertSheet("طلبات_الاشتراك");
    reqSheet.appendRow(["التاريخ", "الاسم", "رقم الهاتف", "طريقة الدفع", "الحالة"]);
    reqSheet.getRange(1, 1, 1, 5).setBackground("#6b21a8").setFontColor("#ffffff").setFontWeight("bold");
    reqSheet.setFrozenRows(1);
  }

  // 6. شيت الأجهزة
  var devSheet = ss.getSheetByName("الأجهزة");
  if (!devSheet) {
    devSheet = ss.insertSheet("الأجهزة");
    devSheet.appendRow(["رقم الهاتف", "بصمة المتصفح (Fingerprint)", "تاريخ أول تسجيل دخول"]);
    devSheet.getRange(1, 1, 1, 3).setBackground("#374151").setFontColor("#ffffff").setFontWeight("bold");
    devSheet.setFrozenRows(1);
  }

  // حذف الورقة الافتراضية الفارغة إن وجدت
  var defaultSheet = ss.getSheetByName("الورقة1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch(e) {}
  }

  return { status: 'success', message: 'تم إنشاء وتهيئة كافة صفحات وقواعد بيانات الشيت بنجاح!' };
}

function initAllSheetsMenu() {
  var ui = SpreadsheetApp.getUi();
  var res = initAllSheets();
  ui.alert('✅ تم بنجاح!', 'تم إنشاء وتجهيز جميع صفحات الشيت بنجاح:\n1. الطلاب\n2. الأسئلة\n3. النتائج\n4. الإعدادات\n5. طلبات التسجيل\n6. الأجهزة', ui.ButtonSet.OK);
}
`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(APPS_SCRIPT_OPTIMIZED_CODE);
    showAlert('تم نسخ الكود بنجاح! يمكنك الآن لصقه في محرر Google Apps Script.');
  };

  const handleUpdateFee = async () => {
    const finalFee = newFeeInput ? newFeeInput : platformFee;
    setIsLoading(true);
    try {
      await fetch(API_URL, { 
        method: 'POST', 
        body: JSON.stringify({ 
          action: 'updateSettings', 
          fee: finalFee, 
          announcement: announcementInput, 
          timerMode: timerMode,
          timerUnitTarget: JSON.stringify(timerUnitTargets),
          timerSecondsPerQ: timerSecondsPerQ,
          publishedLessons: JSON.stringify(publishedLessons),
          apiKey: SECRET_API_KEY 
        }) 
      });
      localStorage.setItem('timerMode', timerMode);
      localStorage.setItem('timerUnitTargets', JSON.stringify(timerUnitTargets));
      localStorage.setItem('timerSecondsPerQ', timerSecondsPerQ.toString());
      showAlert('تم حفظ الإعدادات وتحديث الإشعار للطلاب بنجاح! 📢');
      setPlatformFee(finalFee);
      setAnnouncement(announcementInput);
      setNewFeeInput('');
    } catch(e) { 
      showAlert('خطأ في الاتصال بالإنترنت'); 
    }
    setIsLoading(false);
  };
  
  useEffect(() => {
    let isSyncing = false; // قفل لمنع التزامن المزدوج وإرسال نفس البيانات مرتين
    const syncOfflineResults = async () => {
      if (isSyncing) return;
      try {
        const offlineStr = localStorage.getItem('offlineResults');
        if (offlineStr) {
          const offlineResults = JSON.parse(offlineStr);
          if (!Array.isArray(offlineResults) || offlineResults.length === 0) return;
          
          isSyncing = true;
          const remaining = [];
          // إزالة الطلبات من الذاكرة فوراً لمنع دالة أخرى من التقاطها وتكرار إرسالها
          localStorage.removeItem('offlineResults');
          
          for (const payload of offlineResults) {
            try {
              // تعيين مهلة 8 ثوانٍ للطلب لتجنب التعليق الطويل بسبب ضعف النت الذي يسبب التكرار
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 8000);
              
              const response = await fetch(API_URL, { 
                method: 'POST', 
                body: JSON.stringify(payload),
                signal: controller.signal
              });
              clearTimeout(timeoutId);
              if (!response.ok) throw new Error('Network error');
              const result = await response.json();
              if (result.status !== 'success') throw new Error('Server error');
            } catch(e) {
              remaining.push(payload);
            }
          }
          if (remaining.length > 0) {
            // دمج المتبقي (الفاشل) مع أي طلبات جديدة ربما أضيفت أثناء قيامنا بالمزامنة
            const currentOffline = JSON.parse(localStorage.getItem('offlineResults') || '[]');
            const combined = [...remaining, ...currentOffline];
            // فلترة التكرار (منع وجود نفس الدرس بنفس الدرجة)
            const uniqueCombined = combined.filter((v, i, a) => a.findIndex(t => (t.quiz === v.quiz && t.score === v.score)) === i);
            localStorage.setItem('offlineResults', JSON.stringify(uniqueCombined));
          }
        }
      } catch(e) {
      } finally {
        isSyncing = false;
      }
    };

    const handleOnline = () => syncOfflineResults();
    window.addEventListener('online', handleOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      syncOfflineResults();
    }
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const saveResultToDB = async (scoreObj: { quizName: string; score: string }) => {
    const formattedPhone = formatPhoneStr(inputPhone); 
    if (BASE_STUDENTS[formattedPhone]) return;
    const payload = { 
      action: 'saveResult', 
      phone: formattedPhone.startsWith('0') ? '+20'+formattedPhone.substring(1) : formattedPhone, 
      name: studentName, 
      quiz: scoreObj.quizName, 
      score: scoreObj.score, 
      date: new Date().toLocaleString('ar-EG'), 
      apiKey: SECRET_API_KEY 
    };
    try {
      const response = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('Network error');
      const result = await response.json();
      if (result.status !== 'success') throw new Error('Server error');
    } catch(e) {
      try {
        const offlineResults = JSON.parse(localStorage.getItem('offlineResults') || '[]');
        if (Array.isArray(offlineResults)) {
              // التأكد من عدم وجود هذا الاختبار مسبقاً في طابور المزامنة
              const isDuplicate = offlineResults.some((r: any) => r.quiz === payload.quiz && r.score === payload.score);
              if (!isDuplicate) {
                offlineResults.push(payload);
                localStorage.setItem('offlineResults', JSON.stringify(offlineResults));
              }
        }
      } catch(err) {}
    }
  };
  
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };
  
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    touchEndX.current = e.touches[0].clientX;
  };
  
  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null || isDrawingMode || !activeLesson) return;
    
    const swipeDistance = touchStartX.current - touchEndX.current;
    
    if (swipeDistance > 40) {
      if (isAnswered && currentQIndex < activeLesson.questions.length - 1) {
        setCurrentQIndex(currentQIndex + 1);
      } else if (isAnswered && currentQIndex === activeLesson.questions.length - 1) {
        handleFinishQuiz();
      }
    } else if (swipeDistance < -40) {
      if (currentQIndex > 0) {
        // تم تعطيل الرجوع العشوائي للسابق لمنع الأخطاء والاعتماد على زر المتروك
      }
    }
    
    touchStartX.current = null;
    touchEndX.current = null;
  };
  
  const handleSkip = () => {
    if (!userAnswers[currentQIndex]) {
      setSkippedQuestions(prev => {
        const newSkipped = new Set([...prev, currentQIndex]);
        return Array.from(newSkipped).sort((a, b) => a - b);
      });
    }
    if (currentQIndex < (activeLesson?.questions.length || 0) - 1) {
      setCurrentQIndex(currentQIndex + 1);
    }
  };

  const handleTimeUpReview = () => {
    if (activeLesson) {
      const finalAnswers = [...userAnswers];
      const newMistakesToAdd: Question[] = [];
      
      activeLesson.questions.forEach((q, idx) => {
        if (!finalAnswers[idx]) {
          finalAnswers[idx] = {
            isCorrect: false,
            selected: 'لم يتم الإجابة (انتهى الوقت)',
            concept: q.concept,
            paragraph: q.paragraph,
            type: q.type === 'essay' ? 'essay' : 'mcq'
          };
          newMistakesToAdd.push(q);
        }
      });

      if (newMistakesToAdd.length > 0) {
        setUserAnswers(finalAnswers);
        setMistakesBank(prev => {
          const newBank = [...prev];
          newMistakesToAdd.forEach(q => {
            const qHash = simpleHash(q.q);
            if (!newBank.some(item => simpleHash(item.q) === qHash)) {
              newBank.push(q);
            }
          });
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      }
      setTimeLeft(-1); // إشارة للنظام بأن الوقت انتهى ونحن الآن في وضع المراجعة
    }
  };

  const handleFinishQuiz = () => {
    if (activeLesson) {
      const finalAnswers = [...userAnswers];
      const newMistakesToAdd: Question[] = [];
      
      activeLesson.questions.forEach((q, idx) => {
        if (!finalAnswers[idx]) {
          finalAnswers[idx] = {
            isCorrect: false,
            selected: 'لم يتم الإجابة (انتهى الوقت)',
            concept: q.concept,
            paragraph: q.paragraph,
            type: q.type === 'essay' ? 'essay' : 'mcq'
          };
          newMistakesToAdd.push(q);
        }
      });

      if (newMistakesToAdd.length > 0) {
        setUserAnswers(finalAnswers);
        setMistakesBank(prev => {
          const newBank = [...prev];
          newMistakesToAdd.forEach(q => {
            const qHash = simpleHash(q.q);
            if (!newBank.some(item => simpleHash(item.q) === qHash)) {
              newBank.push(q);
            }
          });
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      }

      const totalQs = activeLesson.questions.length;
      const correct = finalAnswers.filter(a => a.isCorrect).length;
      const perc = Math.round((correct/totalQs)*100);

      // --- Streak Logic ---
      const todayStr = new Date().toDateString();
      setStreak(prev => {
        let newCount = prev.count;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (prev.lastDate === yesterday.toDateString()) {
          newCount += 1;
        } else if (prev.lastDate !== todayStr) {
          newCount = 1;
        }
        const newStreak = { count: newCount, lastDate: todayStr };
        localStorage.setItem('userStreak', JSON.stringify(newStreak));
        return newStreak;
      });

      // --- Badges Logic ---
      setBadges(prev => {
        const newBadges = new Set(prev);
        const hour = new Date().getHours();
        if (hour >= 0 && hour <= 4) newBadges.add('night_owl');
        if (perc === 100 && activeLesson.id !== 'mistakes_bank') newBadges.add('perfect_arrow');
        if (activeLesson.id === 'mistakes_bank' && perc === 100) newBadges.add('mistake_conqueror');
        const badgesArr = Array.from(newBadges);
        localStorage.setItem('userBadges', JSON.stringify(badgesArr));
        return badgesArr;
      });

      if (activeLesson.id !== 'mistakes_bank') {
        saveResultToDB({ quizName: activeLesson.title, score: `${perc}%` });
        
        setLessonScores(prev => {
          // تسجيل الدرجة من أول محاولة فقط بناءً على طلب المعلم وعدم احتساب الإعادات
          if (prev[activeLesson.id] === undefined) {
            const newScores = { ...prev, [activeLesson.id]: correct };
            localStorage.setItem('lessonScores', JSON.stringify(newScores));
            return newScores;
          }
          return prev;
        });
      }
    }
    setScreen('result');
  };
  
  const startQuizForLesson = (lesson: Lesson) => {
    const session = localStorage.getItem('savedSession'); 
    let restored = false;
    if (session) {
      const parsed = JSON.parse(session);
      if (parsed.lessonId === lesson.id) {
        const restoredLesson = {
          ...lesson,
          questions: parsed.questions || lesson.questions
        };
        setActiveLesson(restoredLesson); 
        setUserAnswers(parsed.answers || []); 
        setCurrentQIndex(parsed.currentIndex || 0); 
        setTimeLeft(parsed.timeLeft !== undefined ? parsed.timeLeft : null);
        setScreen('quiz'); 
        setSkippedQuestions(parsed.skippedQuestions || []);
        restored = true;
      }
    }
    if (!restored) { 
      const shuffledQuestions = shuffleArray(lesson.questions).map(q => {
        if (q.type === 'mcq' && q.options && q.options.length > 0) {
          return { ...q, options: shuffleOptions(q.options) };
        }
        return q;
      });
      setActiveLesson({ ...lesson, questions: shuffledQuestions }); 
      setCurrentQIndex(0); 
      setUserAnswers([]); 
      setSkippedQuestions([]);
      setTimeLeft(getInitialTimeLeft(lesson.title, lesson.id, lesson.questions.length));
      setScreen('quiz'); 
    }
    setLessonModalOptions(null); 
  };
  
  let isAnswered = false; 
  let currentAnswer: UserAnswer | null = null; 
  let question: Question | null = null; 
  let totalQs = 0;
  
  if (screen === 'quiz' && activeLesson) {
    question = activeLesson.questions[currentQIndex]; 
    totalQs = activeLesson.questions.length;
    if (question) {
      isAnswered = userAnswers[currentQIndex] !== undefined; 
      currentAnswer = userAnswers[currentQIndex] || null;
    }
  }
  
  const formatLessonTitleJSX = (title: string) => {
    if (!title) return title;
    const parts = title.split(':');
    if (parts.length > 1) {
      return (
        <>
          <span className="text-secondary font-black" style={{ fontSize: '18px' }}>{parts[0]}:</span>
          {parts.slice(1).join(':')}
        </>
      );
    }
    return title;
  };
  
  const renderScreen = () => {
    if (screen === 'returning_welcome') {
      return (
        <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 bg-gray-50 watermark-container">
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-2xl text-center max-w-md w-full border-t-8 border-secondary animate-fade-in relative overflow-hidden">
            <i className="fas fa-hand-sparkles text-5xl sm:text-6xl text-secondary mb-4 block relative z-10"></i>
            <h2 className="text-2xl sm:text-3xl font-black text-primary mb-2 relative z-10">مرحبا بك يا : {studentName} <i className="fas fa-crown text-gold mr-1"></i></h2>
            
            <p className="text-gray-800 text-lg sm:text-xl font-bold mb-6 mt-3 relative z-10 leading-relaxed">
              سعدت بعودتك جاهز يا بطل نكمل
            </p>

            <div className="flex flex-col gap-3 relative z-10 w-full">
              <button 
                onClick={handleResume} 
                disabled={isLoading} 
                className="bg-secondary text-white font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full shadow-md hover:bg-green-600 transition-colors flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <>نعم <i className="fas fa-check-circle"></i></>}
              </button>

              <button onClick={handleLogout} className="text-gray-500 font-bold text-sm underline hover:text-red-500 mt-3 relative z-10 cursor-pointer">
                تسجيل خروج (لست {studentName.split(' ')[0]})
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'home') {
      const livePhone = formatPhoneStr(inputPhone); 
      const liveAdmin = BASE_STUDENTS[livePhone];
      let liveStudents = studentsList[livePhone]; 
      if (liveStudents && !Array.isArray(liveStudents)) liveStudents = [liveStudents];
      const studentsArr = liveStudents as Student[];
      
      return (
        <div className="h-[100dvh] w-full flex items-center justify-center p-4 md:p-6 overflow-y-auto custom-scrollbar relative bg-[#f8fafc] watermark-container">
          <div className="w-full max-w-2xl flex flex-col items-center gap-4 sm:gap-5 py-6 z-10 my-auto">
            
            <i className="fas fa-graduation-cap text-5xl sm:text-7xl md:text-8xl text-gold drop-shadow-sm mb-1.5" style={{ fontSize: '70px', lineHeight: '26px' }}></i>
            <div className="flex flex-row items-center justify-center gap-2 sm:gap-4 mb-2">
              <span className="text-primary font-black sm:text-7xl md:text-8xl tracking-tighter" style={{ fontSize: '35px', lineHeight: '35px' }}>موسوعة</span>
              <div className="w-1.5 h-11 sm:h-20 bg-primary rounded-sm"></div>
              <div className="flex flex-col justify-center text-right">
                <span className="font-black sm:text-3xl md:text-4xl text-gold mb-0.5" style={{ fontSize: '25px', lineHeight: '39px', marginTop: '-2px', marginBottom: '-2px' }}>الكنز</span>
                <span className="text-primary font-black sm:text-3xl md:text-4xl">التعليمي</span>
              </div>
            </div>
            <div className="text-center space-y-2 px-2 mt-1">
              <h2 className="text-lg sm:text-xl md:text-2xl font-black text-gray-800" style={{ textAlign: 'center', fontWeight: 'bold', marginTop: '-13px' }}>بوابتك الذكية لإتقان <span className="text-secondary">({subjectName})</span></h2>
              <p className="sm:text-base md:text-lg text-gray-700 max-w-md mx-auto leading-relaxed border-2 border-gold bg-white/70 backdrop-blur-md p-3 rounded-2xl shadow-sm mt-2" style={{ fontSize: '13px', fontWeight: 'bold', color: '#000000', paddingLeft: '17px', paddingRight: '16px', paddingBottom: '14px', paddingTop: '14px', marginLeft: '-2px', lineHeight: '25.125px' }}>منصتك الشاملة للمراجعة المستمرة واختبار قدراتك وإعدادك للامتحان بأسلوب تفاعلي مميز وعصري وفقاً لآخر التعديلات.</p>
            </div>
            <div className="inline-block bg-primary text-white px-8 py-2 rounded-full font-bold shadow-md text-sm sm:text-base text-center" style={{ marginTop: '-9px', marginBottom: '-18px' }}>لـ {gradeName}</div>
            
            <div className="w-full max-w-xs sm:max-w-sm md:max-w-md bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-6 md:p-8 pt-10 border border-gray-100 flex flex-col items-center gap-4 relative mt-2">
              <div className="absolute top-0 right-0 bg-secondary text-white text-xs sm:text-sm font-black px-5 py-2 rounded-tr-[1.5rem] rounded-bl-[1.5rem] shadow-sm" style={{ marginBottom: '-12px' }}>المراجعة الذهبية</div>
              <h3 className="text-xl sm:text-2xl font-black text-primary mt-4" style={{ marginTop: '1px', marginBottom: '-9px' }}>ابدأ رحلتك الآن</h3>
              
              <div className="w-full relative mt-2">
                <input 
                  type="tel" 
                  placeholder="أدخل رقم الهاتف المسجل لدينا" 
                  className={`w-full text-center border-b-2 border-gray-200 focus:border-primary outline-none py-3 text-sm sm:text-base font-bold text-gray-600 transition-colors ${showPasswordInput ? 'opacity-50' : ''}`} 
                  value={inputPhone} 
                  onChange={(e) => { 
                    setInputPhone(e.target.value); 
                    setSelectedTwin(null); 
                    if (showPasswordInput) { 
                      setShowPasswordInput(false); 
                      setInputPassword(''); 
                    } 
                  }} 
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()} 
                  disabled={showPasswordInput} 
                  style={{ marginTop: '-18px', marginBottom: '2px' }}
                />
                {liveAdmin && !showPasswordInput && <div className="text-secondary font-black text-sm mt-3 text-center">مرحباً يا : {liveAdmin.name}</div>}
                {liveStudents && !showPasswordInput && !liveAdmin && (
                  <div className="w-full mt-4">
                    {studentsArr.length === 1 ? <div className="text-secondary font-black text-sm text-center">مرحباً يا : {studentsArr[0].name}</div> : (
                      <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-xl border border-gray-200">
                        <div className="text-primary font-bold text-sm text-center">يوجد أكثر من طالب، هل أنت:</div>
                        <div className="flex flex-wrap justify-center gap-2">
                          {studentsArr.map((st, idx) => (
                            <button 
                              key={idx} 
                              onClick={() => { 
                                setSelectedTwin(st); 
                                setLoginError(''); 
                              }} 
                              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm border-2 ${selectedTwin?.name === st.name ? 'bg-secondary text-white border-secondary' : 'bg-white text-gray-700 hover:border-secondary'}`}
                            >
                              {st.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {showPasswordInput && (
                  <div className="w-full text-center mt-4">
                    <div className="text-secondary font-black text-sm mb-2">
                      مرحباً يا : {liveAdmin?.name || selectedTwin?.name || (studentsArr && studentsArr.length === 1 ? studentsArr[0].name : '')}
                    </div>
                    <input 
                      type={liveAdmin ? "password" : "text"} 
                      placeholder={liveAdmin ? "الرقم السري" : "أدخل كود الطالب (الشهري)"} 
                      className="w-full text-center border-b-2 border-gray-300 focus:border-secondary outline-none py-2 text-base font-bold tracking-wider" 
                      value={inputPassword} 
                      onChange={(e) => setInputPassword(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()} 
                      autoFocus 
                    />
                    {!liveAdmin && (
                      <p className="text-[11px] text-gray-500 font-bold mt-1.5 flex items-center justify-center gap-1">
                        <i className="fas fa-shield-alt text-amber-500"></i> يُطلب الكود لمرة واحدة فقط بداية كل شهر
                      </p>
                    )}
                  </div>
                )}
                {loginError && <div className="text-red-500 text-xs sm:text-sm font-bold mt-4 text-center bg-red-50 py-2 px-3 rounded-lg border border-red-100"><i className="fas fa-exclamation-circle"></i> {loginError}</div>}
              </div>
              
              <button onClick={handleLogin} disabled={isLoading} className="w-full bg-primary text-white font-bold text-base sm:text-lg py-3.5 rounded-xl hover:bg-gray-900 transition-colors duration-300 shadow-md mt-2 flex items-center justify-center gap-2 cursor-pointer">
                {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <>دخول <i className="fas fa-arrow-left"></i></>}
              </button>

              {showInstallBtn && (
                <button 
                  onClick={handleInstallClick} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                  style={{ marginTop: '-8px', marginBottom: '-16px' }}
                >
                  <i className="fas fa-download text-lg"></i> تثبيت التطبيق على الهاتف أو الكمبيوتر 📱💻
                </button>
              )}
              
              <div className="text-center mt-4 text-lg sm:text-xl flex justify-center gap-1.5 w-full">
                <span className={isDarkMode ? "text-gray-100 font-bold" : "text-primary font-bold"} style={{ fontSize: '21px' }}>رؤية وإعداد</span> <span className="text-pink-600 font-black" style={{ fontSize: '23px' }}>أ/ إسلام سعود</span>
              </div>
            </div>
          </div>
          
          {showUnpaidModal && studentData && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col">
                <i className="fas fa-hand-holding-usd text-5xl text-red-500 mb-4 block"></i>
                <h2 className="text-2xl font-black text-primary mb-2">الحساب موقوف مؤقتاً</h2>
                
                {studentData.missingMonths && studentData.missingMonths.length > 0 ? (
                  <p className="text-gray-700 font-bold mb-3 text-base leading-relaxed">
                    تم إيقاف حسابك مؤقتاً لعدم سداد اشتراك شهر: <span className="text-red-600">({studentData.missingMonths?.join('، ')})</span>
                  </p>
                ) : (
                  <p className="text-gray-700 font-bold mb-3 text-base leading-relaxed">
                    تم إيقاف حسابك مؤقتاً لعدم سداد الاشتراك.
                  </p>
                )}
                
                <div className="border-2 border-dashed border-gray-300 bg-gray-50 p-3 rounded-xl mb-4">
                  <span className="text-gray-800 font-bold">للسداد إلى رقم:</span><br/>
                  <span className="text-primary font-black text-xl" dir="ltr">01228466613</span>
                </div>
                
                <p className="text-sm font-bold text-gray-500 mb-2">اختر طريقة السداد:</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setUnpaidPaymentMethod('فودافون كاش')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${unpaidPaymentMethod === 'فودافون كاش' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>فودافون كاش</button>
                  <button onClick={() => setUnpaidPaymentMethod('إنستاباي')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${unpaidPaymentMethod === 'إنستاباي' ? 'bg-purple-50 border-purple-500 text-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>إنستاباي</button>
                </div>
                
                <p className="text-sm font-bold text-secondary mb-4">ثم انتظار رد الإدارة للتفعيل.</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      if (!unpaidPaymentMethod) { 
                        showAlert('الرجاء اختيار طريقة الدفع (فودافون كاش أو إنستاباي) أولاً.'); 
                        return; 
                      }
                      const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأنا الطالب(ة): ${studentData.name}\nأرغب في سداد متأخرات شهر (${studentData.missingMonths?.join('، ')}) لتفعيل حسابي.\nقمت بالسداد من خلال: ${unpaidPaymentMethod}\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
                    window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
                    }} 
                    className="w-full bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors flex justify-center items-center gap-2"
                  >
                    <i className="fab fa-whatsapp text-xl"></i> إرسال صورة التحويل
                  </button>
                  <button onClick={() => {setShowUnpaidModal(false); setStudentData(null); setUnpaidPaymentMethod('');}} className="w-full bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors">إغلاق وعودة</button>
                </div>
              </div>
            </div>
          )}

          {showGraceModal && studentData && (
            <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col border-2 border-amber-300 relative">
                <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-300 flex items-center justify-center mx-auto mb-3 shadow-inner">
                  <span className="text-3xl">⏳</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-amber-950 mb-1">تذكير بسداد الاشتراك 🌟</h2>
                <div className="inline-block bg-amber-100 text-amber-900 text-xs font-black px-3.5 py-1 rounded-full mx-auto mb-3 border border-amber-200">
                  مهلة السداد تنتهي يوم 5 {toEasternArabic(new Date().getMonth() + 1)} (متبقي {toEasternArabic(studentData.graceDaysRemaining || 1)} {studentData.graceDaysRemaining === 1 ? 'يوم' : 'أيام'})
                </div>
                
                <p className="text-gray-700 font-bold mb-3 text-xs sm:text-sm leading-relaxed text-right bg-amber-50/60 p-3 rounded-2xl border border-amber-200">
                  أهلاً بك يا بطل 🎓 نود تذكيرك بأن اشتراك شهر <span className="text-amber-800 font-black">({studentData.graceMonths?.join('، ')})</span> لم يُسجل سداده بعد. نرجو المبادرة بالسداد قبل انتهاء المهلة يوم 5 لضمان استمرار فتح الامتحانات والخدمات دون توقف.
                </p>
                
                <div className="border border-dashed border-gray-300 bg-gray-50 p-2.5 rounded-xl mb-3 text-center">
                  <span className="text-gray-600 text-xs font-bold">فودافون كاش / إنستاباي:</span><br/>
                  <span className="text-primary font-black text-lg" dir="ltr">01228466613</span>
                </div>
                
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      const whatsappMsg = `السلام عليكم ورحمة الله وبركاته، أ/ إسلام سعود.\nأنا الطالب(ة): ${studentData.name}\nأرغب في سداد اشتراك شهر (${studentData.graceMonths?.join('، ')}).\n(سأقوم بإرفاق صورة التحويل الآن لتأكيد السداد)`;
                      window.open(`https://wa.me/201228466613?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
                    }} 
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-2.5 rounded-xl shadow-md transition-all flex justify-center items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <i className="fab fa-whatsapp text-lg"></i> إرسال التحويل عبر واتساب
                  </button>
                  <button 
                    onClick={async () => {
                      setShowGraceModal(false);
                      if (pendingGraceLogin) {
                        await pendingGraceLogin();
                      }
                    }} 
                    className="w-full bg-primary hover:bg-gray-900 text-white font-black text-sm py-2.5 rounded-xl shadow-sm transition-all flex justify-center items-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    متابعة إلى المنصة والمذاكرة 🚀
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {showWelcomeSubscribeModal && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col">
                <i className="fas fa-crown text-5xl text-gold mb-4 block drop-shadow-sm"></i>
                <h2 className="text-2xl font-black text-primary mb-2">أهلاً بك يا بطل!</h2>
                <p className="text-gray-700 font-bold mb-6 text-base leading-relaxed">أهلاً بك في منصتك الأولى لضمان الدرجة النهائية.<br/>هل تود الاشتراك معنا؟</p>
                <div className="flex gap-3">
                  <button onClick={() => { setShowWelcomeSubscribeModal(false); setShowRegisterModal(true); }} className="flex-1 bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors">نعم</button>
                  <button onClick={() => { setShowWelcomeSubscribeModal(false); setInputPhone(''); }} className="flex-1 bg-red-600 text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-red-700 transition-colors">لا</button>
                </div>
              </div>
            </div>
          )}
          
          {showRegisterModal && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in flex flex-col relative max-h-[90dvh] overflow-y-auto custom-scrollbar">
                <i className="fas fa-user-plus text-5xl text-primary mb-4 block"></i>
                <h2 className="text-2xl font-black text-primary mb-2">تسجيل طالب جديد</h2>
                <input 
                  type="text" 
                  placeholder="اسم الطالب رباعي" 
                  className="w-full text-center border-2 border-gray-200 focus:border-primary outline-none py-3 px-4 rounded-xl mb-4 text-sm font-bold" 
                  value={registerName} 
                  onChange={(e) => setRegisterName(e.target.value)} 
                />
                
                <div className="bg-blue-50 border border-blue-100 p-2 rounded-xl mb-3 flex justify-center items-center gap-2">
                  <span className="text-gray-700 font-bold text-sm">قيمة الاشتراك:</span>
                  <span className="text-secondary font-black text-lg">{platformFee} ج.م</span>
                </div>
                
                <div className="border-2 border-dashed border-gray-300 bg-gray-50 p-3 rounded-xl mb-4">
                  <span className="text-gray-800 font-bold">يتم تحويل الاشتراك إلى رقم:</span><br/>
                  <span className="text-primary font-black text-xl" dir="ltr">01228466613</span>
                </div>
                
                <p className="text-sm font-bold text-gray-500 mb-2">أخبرنا بطريقة السداد:</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setRegisterNameMethod('فودافون كاش')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${registerMethod === 'فودافون كاش' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>فودافون كاش</button>
                  <button onClick={() => setRegisterNameMethod('إنستاباي')} className={`flex-1 p-3 rounded-xl border-2 font-black transition-all ${registerMethod === 'إنستاباي' ? 'bg-purple-50 border-purple-500 text-purple-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>إنستاباي</button>
                </div>
                
                <p className="text-sm font-black text-red-600 mb-4">قم بإرفاق وصل السداد</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => { 
                      handleRegisterSubmit(); 
                      setShowRegisterModal(false); 
                    }} 
                    className="w-full bg-secondary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-green-700 transition-colors flex justify-center items-center gap-2"
                  >
                    <i className="fab fa-whatsapp text-xl"></i> إرسال صورة التحويل
                  </button>
                  <button onClick={() => {setShowRegisterModal(false); setRegisterNameMethod('');}} className="w-full bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-colors">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    
    if (screen === 'index') {
      const isTeacherAdmin = BASE_STUDENTS[formatPhoneStr(inputPhone)]?.role === 'admin';
      return (
        <div className={`h-[100dvh] flex flex-col watermark-container ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <div className={`shadow-sm px-3 pt-3 md:pt-4 lg:pt-3 pb-2 z-10 border-b-2 flex justify-between items-center gap-2 sm:gap-4 w-full shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`} style={{ paddingRight: '13px', paddingBottom: '-5px', paddingTop: '10px', paddingLeft: '10px' }}>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
              <i className="fas fa-graduation-cap text-2xl sm:text-3xl md:text-4xl text-gold shrink-0" style={{ fontSize: '26px', lineHeight: '24px', marginRight: '-9px', borderRadius: '-2px' }}></i>
              <div className="flex flex-col items-start text-right min-w-0 shrink">
                <div className="flex items-center gap-2">
                  <div className="font-black text-[12px] sm:text-lg md:text-xl lg:text-2xl leading-none whitespace-nowrap">
                    <span className="text-secondary" style={{ marginRight: '-6px', marginLeft: '1px', marginTop: '0px', marginBottom: '2px', lineHeight: '12px', fontSize: '13px', textAlign: 'center', paddingTop: '5px', paddingBottom: '0px', paddingRight: '0px', paddingLeft: '0px' }}>موسوعة </span>
                    <span className={isDarkMode ? 'text-gray-100' : 'text-primary'} style={{ marginTop: '-1px', paddingTop: '5px' }}>الكنز التعليمي</span>
                  </div>
                  {streak.count > 0 && (
                    <div className={`px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black flex items-center gap-1 shadow-sm border ${isDarkMode ? 'bg-orange-950/40 border-orange-700 text-orange-400' : 'bg-orange-50 border-orange-200 text-orange-600'}`} title="شعلة التحدي اليومي">
                      <i className="fas fa-fire animate-pulse text-orange-500"></i> {toEasternArabic(streak.count)}
                    </div>
                  )}
                </div>
                <div className="text-[8px] sm:text-[10px] md:text-xs lg:text-sm font-bold mt-1 flex gap-1 justify-start whitespace-nowrap">
                  <span className={isDarkMode ? "text-gray-200 font-bold" : "text-primary font-bold"} style={{ lineHeight: '19px', marginTop: '3px' }}>رؤية وإعداد</span>
                  <span className="text-pink-600 font-black" style={{ lineHeight: '19px', fontSize: '10px', height: '20px', marginTop: '3px' }}>أ/ إسلام سعود</span>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-1.5 shrink-0 w-full max-w-[65%] sm:max-w-[55%]">
              <div className="flex items-center gap-1.5 w-full justify-end" style={isDesktop ? { height: 'auto' } : { paddingRight: '0px', paddingLeft: '-2px', height: '23px', width: '177.797px' }}>
                {isTeacherAdmin && (
                  <button onClick={() => setScreen('admin')} className="bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe] px-1.5 py-0.5 md:py-1 rounded-md text-[8px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm hover:bg-blue-100 transition-colors shrink-0">
                    إدارة <i className="fas fa-user-shield"></i>
                  </button>
                )}
                <button onClick={toggleFullscreen} className={`w-6 h-6 md:w-8 md:h-8 rounded-md flex items-center justify-center text-[10px] md:text-sm shadow-sm transition-colors shrink-0 border cursor-pointer ${isFullscreen ? 'bg-secondary text-white border-secondary' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`} title="تكبير" style={{ paddingBottom: '0px', paddingRight: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '3px' }}>
                  <i className={`fas ${isFullscreen?'fa-compress':'fa-expand'}`} style={{ lineHeight: '11px', fontSize: '10px', marginLeft: '-4px', marginRight: '-2px', marginBottom: '-2px', marginTop: '-1px' }}></i>
                </button>
                <button onClick={()=>setIsDarkMode(!isDarkMode)} className={`w-6 h-6 md:w-8 md:h-8 rounded-md flex items-center justify-center text-[10px] md:text-sm shadow-sm transition-colors shrink-0 border cursor-pointer ${isDarkMode ? 'bg-gray-700 text-white border-gray-600 hover:bg-gray-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`} title="ليلي" style={{ marginRight: '-6px', marginLeft: '0px', marginTop: '0px', lineHeight: '12px', fontSize: '11px', textAlign: 'center', paddingTop: '-3px', paddingLeft: '-3px', paddingRight: '-2px', paddingBottom: '-2px', borderColor: '#022366' }}>
                  <i className={`fas ${isDarkMode?'fa-sun':'fa-moon'}`} style={{ marginRight: '0px', marginLeft: '0px', textAlign: 'center' }}></i>
                </button>
                <div className={`px-2 py-0.5 md:py-1 rounded-md text-[8px] sm:text-xs md:text-sm font-black shadow-sm text-center shrink-0 whitespace-nowrap border ${isDarkMode ? 'bg-amber-900 text-amber-100 border-amber-600' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                  {gradeName}
                </div>
              </div>
            <div className="flex justify-start sm:justify-end items-center gap-1.5 w-full overflow-x-auto flex-nowrap custom-scrollbar pb-0.5 mt-0.5">
                <button onClick={handleRefresh} disabled={isLoading} className={`px-2 py-0.5 md:py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm transition-colors shrink-0 border ${isDarkMode ? 'bg-blue-900 text-blue-100 border-blue-800 hover:bg-blue-800' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`} style={{ marginTop: '0px' }}>
                  تحديث <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
                </button>
                
                <button 
                  onClick={() => showConfirm('هل أنت متأكد من مسح جميع إجاباتك والبدء من جديد؟\nتحذير: سيؤدي هذا إلى فقدان تقدمك الحالي وترتيبك في لوحة الشرف!', () => {
                    const completedLessonNames: string[] = [];
                    data.forEach(u => u.lessons.forEach(l => { if(l.completed) completedLessonNames.push(l.title); }));
                    
                    if (completedLessonNames.length > 0) {
                      saveResultToDB({ 
                        quizName: `تصفير 🗑️: ${completedLessonNames.join(' ، ')}`, 
                        score: 'تصفير 🔄' 
                      });
                    }
                    
                    localStorage.removeItem('completedLessons');
                    localStorage.removeItem('userStats');
                    localStorage.removeItem('savedSession');
                    localStorage.removeItem('mistakesBank');
                    localStorage.removeItem('lessonScores');
                    localStorage.removeItem('userStreak');
                    localStorage.removeItem('userBadges');
                    setStreak({ count: 0, lastDate: '' });
                    setBadges([]);
                    setLessonScores({});
                    setMistakesBank([]);
                    const resetData = data.map(unit => ({ ...unit, lessons: unit.lessons.map(l => ({ ...l, completed: false })) }));
                    setData(resetData); 
                    setActiveFilter('all'); 
                  })} 
                  className="bg-[#fff1f2] text-[#ef4444] border border-[#fecaca] px-2 py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-black flex items-center gap-1 shadow-sm hover:bg-red-50 transition-colors shrink-0"
                  style={{ marginTop: '0px' }}
                >
                  تصفير <i className="fas fa-sync-alt"></i>
                </button>
                <button onClick={handleLogout} className="text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-2 py-1 rounded-md text-[9px] md:text-xs lg:text-sm font-bold transition-colors border border-red-100 shadow-sm flex items-center gap-1 shrink-0" style={{ marginLeft: '1px', marginTop: '0px' }}>
                  خروج <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            </div>
          </div>
          
          <div 
            className="px-3 pt-3 pb-2 z-10 shrink-0 mx-auto w-full max-w-4xl md:px-4" 
            style={isDesktop ? { height: 'auto', width: '100%', marginBottom: '13px', marginTop: '0px' } : { height: 'auto', width: '100%', paddingBottom: '6px', paddingTop: '1px', marginBottom: '13px', marginTop: '0px' }}
          >
            <div 
              className="grid grid-cols-4 gap-1.5 sm:gap-2 w-full max-w-4xl mx-auto px-1" 
              dir="rtl" 
              style={isDesktop ? { fontSize: '15px', lineHeight: '24px' } : { fontSize: '17px', lineHeight: '24px', marginTop: '-13px' }}
            >
              <div 
                className="bg-primary text-white rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md" 
                style={isDesktop ? { marginTop: '0px' } : { marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-gray-300 mb-0.5" style={{ height: '18px', marginRight: '-4px', marginLeft: '-5px', marginBottom: '-2px', marginTop: '-2px' }}>التقدم</div>
                <div className="text-sm sm:text-base font-black flex items-center gap-0.5 text-secondary" dir="ltr">
                  <span style={{ borderColor: '#ffffff' }}>%</span><span style={{ borderColor: '#ffffff' }}>{toEasternArabic(stats.progress)}</span>
                </div>
              </div>
              <button 
                onClick={()=>setActiveFilter('all')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md transition-all ${activeFilter==='all'?'bg-secondary text-white ring-2 ring-offset-1 ring-secondary':'bg-secondary text-white opacity-90'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', lineHeight: '13px', textAlign: 'center', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-green-100 mb-0.5">الدروس</div>
                <div className="text-sm sm:text-base font-black">{toEasternArabic(stats.total)}</div>
              </button>
              <button 
                onClick={()=>setActiveFilter('completed')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center border shadow-sm transition-all ${activeFilter==='completed'?'bg-green-50 border-green-500 ring-1 ring-green-500':'bg-white border-gray-200 hover:border-green-400'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', textAlign: 'center', lineHeight: '13px', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-green-500 mb-0.5">المنجز</div>
                <div className="text-sm sm:text-base font-black text-green-500">{toEasternArabic(stats.completed)}</div>
              </button>
              <button 
                onClick={()=>setActiveFilter('remaining')} 
                className={`rounded-xl py-2 px-1 flex flex-col items-center justify-center shadow-md transition-all ${activeFilter==='remaining'?'bg-red-600 text-white ring-2 ring-offset-1 ring-red-600':'bg-[#ef4444] text-white hover:bg-red-600'}`} 
                style={isDesktop ? { fontSize: '11px', textAlign: 'center', marginTop: '0px' } : { fontSize: '10px', lineHeight: '13px', marginTop: '20px' }}
              >
                <div className="text-[10px] sm:text-xs font-bold text-white mb-0.5">المتبقي</div>
                <div className="text-sm sm:text-base font-black text-white">{toEasternArabic(stats.remaining)}</div>
              </button>
            </div>

            {mistakesBank.length > 0 && (
              <button 
                onClick={() => {
                  const shuffledMistakes = shuffleArray(mistakesBank).map(q => {
                    if (q.type === 'mcq' && q.options && q.options.length > 0) {
                      return { ...q, options: shuffleOptions(q.options) };
                    }
                    return q;
                  });
                  setActiveLesson({ id: 'mistakes_bank', title: 'بنك الأخطاء 🎯', questions: shuffledMistakes, completed: false });
                  setCurrentQIndex(0);
                  setUserAnswers([]);
                  setSkippedQuestions([]);
                  setTimeLeft(null);
                  setScreen('quiz');
                }} 
                className="w-full mt-2.5 py-2 px-3 rounded-xl flex items-center justify-between shadow-sm transition-all bg-rose-50 border-2 border-rose-400 hover:bg-rose-100 active:scale-[0.99]"
                dir="rtl"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">🎯</span>
                  <span className="text-xs sm:text-sm font-black text-rose-700">تدرب على أسئلة بنك الأخطاء</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="bg-rose-600 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-sm">
                    {toEasternArabic(mistakesBank.length)} {mistakesBank.length === 1 ? 'خطأ' : 'أخطاء'}
                  </span>
                  <i className="fas fa-chevron-left text-rose-600 text-xs"></i>
                </div>
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 pt-0 z-10">
            <div className="max-w-4xl mx-auto space-y-4">
              {announcement && announcement.trim() !== "" && announcement !== dismissedAnnouncement && (
                <div className="bg-orange-50 border-r-4 border-gold p-4 rounded-2xl shadow-sm flex items-start gap-3 animate-fade-in mb-2 relative" style={{ fontSize: '11px', lineHeight: '21px', marginBottom: '6px', marginTop: '-5px', paddingLeft: '14px', paddingTop: '9px' }}>
                  <button onClick={() => {
                    setDismissedAnnouncement(announcement);
                    localStorage.setItem('dismissedAnnouncement', announcement);
                  }} className="absolute top-2 left-2 text-gray-400 hover:text-red-500 transition-colors p-1" title="إخفاء الإشعار">
                    <i className="fas fa-times"></i>
                  </button>
                  <span className="text-gold text-xl shrink-0"><i className="fas fa-bullhorn animate-bounce"></i></span>
                  <div className="flex-1">
                    <h4 className="font-black text-gold text-xs sm:text-sm mb-0.5">تنبيه هام من الأستاذ 📢:</h4>
                    <p className="text-gray-800 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-line" style={{ fontSize: '13px', textAlign: 'justify', lineHeight: '19.5px' }}>{announcement}</p>
                  </div>
                </div>
              )}
              
              {stats.total === 0 ? (
                <div className={`rounded-3xl shadow-md border-2 p-8 text-center animate-fade-in flex flex-col items-center justify-center mt-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white'}`}>
                  <i className="fas fa-book-reader text-6xl text-secondary mb-4 opacity-80"></i>
                  <h2 className={`text-2xl font-black mb-2 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>مرحباً بك في منصتنا</h2>
                  <p className={`text-lg font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>سيتم إضافة الدروس قريباً</p>
                </div>
              ) : (
                studentUnits.map(unit => {
                  if (unit.lessons.length === 0) return null;
                  if (activeFilter !== 'all' && !unit.lessons.some(l => activeFilter === 'completed' ? l.completed : !l.completed)) return null;
                  return (
                    <div key={unit.id} className={`rounded-2xl shadow-lg border overflow-hidden animate-fade-in backdrop-blur-md transition-all ${isDarkMode ? 'bg-gray-800/50 border-gray-700/50' : 'bg-white/60 border-gray-150/50'}`}>
                      <div className={`px-4 py-4 border-b cursor-pointer flex justify-between items-center transition-colors ${isDarkMode ? 'bg-gray-700/40 border-gray-600/40 hover:bg-gray-700/60' : 'bg-gray-50/50 border-gray-200/40 hover:bg-gray-50/70'}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => toggleUnit(unit.id)}>
                          <h2 className={`text-xl font-black truncate ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>{unit.title}</h2>
                          <i className={`fas fa-chevron-${expandedUnits.includes(unit.id) ? 'up' : 'down'} ${isDarkMode ? 'text-gray-300' : ''}`}></i>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleResetUnit(unit.id); }}
                          title={`تصفير وحدة: ${unit.title}`}
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs transition-colors shrink-0 border ${
                            isDarkMode 
                              ? 'bg-rose-950/30 text-rose-300 border-rose-800/50 hover:bg-rose-900/50' 
                              : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          <i className="fas fa-sync-alt"></i>
                        </button>
                      </div>
                      {(expandedUnits.includes(unit.id) || activeFilter !== 'all') && (
                        <div className={`divide-y backdrop-blur-sm ${isDarkMode ? 'divide-gray-700/50' : 'divide-gray-100/50'}`} style={{ fontSize: '10px' }}>
                          {unit.lessons.filter(l => activeFilter === 'all' || (activeFilter === 'completed' ? l.completed : !l.completed)).map(lesson => (
                            <div 
                              key={lesson.id} 
                              onClick={() => { 
                                if (lesson.audio || lesson.video) {
                                  setLessonModalOptions(lesson);
                                } else {
                                  startQuizForLesson(lesson);
                                }
                              }} 
                              className={`px-6 py-5 flex justify-between items-center cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700/40' : 'hover:bg-gray-50/50'}`}
                            >
                              <div className={`font-bold text-lg ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{formatLessonTitleJSX(lesson.title)}</div>
                              {lesson.completed ? <i className="fas fa-check-circle text-secondary text-2xl"></i> : <i className="fas fa-play-circle text-gray-300 text-2xl"></i>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              
              <div className="mt-4 mb-8 w-full z-10 shrink-0 flex flex-col sm:flex-row flex-wrap gap-3">
                <button onClick={handleOpenLeaderboard} className={`flex-1 min-w-[200px] font-black py-4 rounded-2xl shadow-sm transition-transform active:scale-95 flex justify-center items-center gap-3 border-2 ${isDarkMode ? 'bg-amber-900 border-amber-700 text-amber-100 hover:bg-amber-800' : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-200'}`}>
                  <i className="fas fa-trophy text-2xl sm:text-3xl animate-pulse text-gold"></i> <span className="text-lg sm:text-xl">أوائل الكنز</span>
                </button>
                
                {mapsList && mapsList.length > 0 && (
                  <button onClick={() => setScreen('maps')} className={`flex-1 min-w-[200px] font-black py-4 rounded-2xl shadow-sm transition-transform active:scale-95 flex justify-center items-center gap-3 border-2 ${isDarkMode ? 'bg-indigo-900 border-indigo-700 text-indigo-100 hover:bg-indigo-800' : 'bg-indigo-50 border-indigo-300 text-indigo-800 hover:bg-indigo-200'}`}>
                    <i className="fas fa-map-marked-alt text-2xl sm:text-3xl animate-bounce"></i> <span className="text-lg sm:text-xl">الخرائط التفاعلية</span>
                  </button>
                )}

                <button onClick={() => {
                  const appLink = window.location.href.split('?')[0];
                  const whatsappText = encodeURIComponent(`موسوعة الكنز التعليمي للأستاذ إسلام سعود 🌍\nأقوى منصة لمراجعة مادة التاريخ!\n\nادخل وسجل الآن مجاناً من هنا 👇:\n${appLink}`);
                  window.open(`https://wa.me/?text=${whatsappText}`, '_blank');
                }} className={`flex-1 min-w-[200px] font-black py-4 rounded-2xl shadow-sm transition-transform active:scale-95 flex justify-center items-center gap-3 border-2 ${isDarkMode ? 'bg-green-900 border-green-700 text-green-100 hover:bg-green-800' : 'bg-green-50 border-green-300 text-green-800 hover:bg-green-200'}`}>
                  <i className="fab fa-whatsapp text-2xl sm:text-3xl text-green-600"></i> <span className="text-lg sm:text-xl">شارك المنصة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'maps') {
      return (
        <div className={`h-[100dvh] flex flex-col watermark-container ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          <div className={`shadow-sm px-4 pt-4 pb-3 z-10 border-b-2 flex justify-between items-center w-full shrink-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'}`}>
            <div className="flex items-center gap-3">
              <i className="fas fa-map-marked-alt text-3xl sm:text-4xl text-indigo-500"></i>
              <div className="font-black text-xl sm:text-2xl text-indigo-600">الخرائط التفاعلية</div>
            </div>
            <button onClick={() => { setScreen('index'); setActiveMapUrl(null); }} className="bg-primary text-white font-bold px-5 py-2.5 rounded-xl text-sm sm:text-base shadow-md active:scale-95 transition-transform flex items-center gap-2">
              عودة <i className="fas fa-arrow-left"></i>
            </button>
          </div>
          
          <div className="flex-1 p-4 sm:p-6 z-10 flex flex-col">
            {activeMapUrl ? (
              <div className="w-full h-full relative rounded-3xl overflow-hidden border-4 border-indigo-200 shadow-2xl bg-white flex flex-col animate-fade-in">
                <div className="bg-indigo-100 px-4 py-2 flex justify-between items-center border-b border-indigo-200">
                  <span className="font-bold text-indigo-800"><i className="fas fa-info-circle ml-1"></i> تفاعل مع الخريطة</span>
                  <button onClick={() => setActiveMapUrl(null)} className="bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow font-black text-lg hover:bg-red-600 transition-colors">×</button>
                </div>
                <iframe src={activeMapUrl} className="flex-1 w-full border-0 bg-white" title="Interactive Map"></iframe>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-4 animate-fade-in">
                {mapsList && mapsList.map(map => (
                  <div key={map.id} onClick={() => setActiveMapUrl(map.url)} className={`p-8 rounded-3xl shadow-lg border-2 cursor-pointer transition-transform hover:-translate-y-2 flex flex-col items-center text-center relative overflow-hidden group ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:border-indigo-500' : 'bg-white border-gray-100 hover:border-indigo-400'}`}>
                    <div className="absolute top-0 right-0 w-full h-2 bg-indigo-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-right"></div>
                    <i className="fas fa-map-location-dot text-6xl text-indigo-200 group-hover:text-indigo-500 transition-colors mb-4 block"></i>
                    <h3 className={`text-xl font-black mt-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{map.title}</h3>
                    <span className="mt-4 text-sm font-bold bg-indigo-50 text-indigo-600 py-1 px-4 rounded-full border border-indigo-100">فتح الخريطة</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    if (screen === 'quiz' && activeLesson && question) {
      const handleOptionClick = (option: string) => {
        if (isAnswered) return;
        const isCorrect = option === question!.correct;
        const newAns = [...userAnswers]; 
        newAns[currentQIndex] = { 
          isCorrect, 
          selected: option, 
          concept: question!.concept, 
          paragraph: question!.paragraph, 
          type: 'mcq' 
        }; 
        setUserAnswers(newAns);
        setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));
        
        // Show temporary feedback toast for MCQ questions (lasting ~1 second)
        if (isCorrect) {
          setFeedbackToast({ isCorrect: true, message: '👍' });
        } else {
          setFeedbackToast({ isCorrect: false, message: '😔' });
        }
        setTimeout(() => {
          setFeedbackToast(null);
        }, 1100);
        
        setMistakesBank(prev => {
          const newBank = [...prev];
          const qHash = simpleHash(question!.q);
          const existsIndex = newBank.findIndex(item => simpleHash(item.q) === qHash);
          
          if (!isCorrect && existsIndex === -1) {
            newBank.push(question!); 
          } else if (isCorrect && existsIndex !== -1) {
            newBank.splice(existsIndex, 1); 
          }
          localStorage.setItem('mistakesBank', JSON.stringify(newBank));
          return newBank;
        });
      };
      
      const handleEssayReveal = () => {
        if (isAnswered) return;
        const newAns = [...userAnswers]; 
        newAns[currentQIndex] = { 
          isCorrect: true, 
          concept: question!.concept, 
          paragraph: question!.paragraph, 
          type: 'essay' 
        }; 
        setUserAnswers(newAns);
        setSkippedQuestions(prev => prev.filter(idx => idx !== currentQIndex));
      };
      
      return (
        <div className={`h-[100dvh] flex flex-col watermark-container relative ${isDarkMode?'bg-gray-900':''}`} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
          <DrawingCanvas isEnabled={isDrawingMode} />
          
          <div className={`shadow-md px-2 sm:px-4 pt-3 md:pt-4 lg:pt-3 pb-2 flex justify-between items-center gap-1 z-50 sticky top-0 shrink-0 w-full border-b-4 border-primary ${isDarkMode?'bg-gray-800':'bg-white'}`}>
            <div className="flex items-center gap-1 min-w-0 shrink">
              <i className={`fas fa-graduation-cap text-lg sm:text-2xl md:text-3xl lg:text-4xl shrink-0 ${isDarkMode?'text-gray-100':'text-gold'}`}></i>
              <div className="flex flex-col items-center text-center min-w-0 shrink">
                <div className="flex items-center gap-1 font-black text-[11px] sm:text-sm md:text-lg lg:text-xl leading-none mb-0.5 whitespace-nowrap">
                  <span className={isDarkMode?'text-secondary':'text-secondary'}>موسوعة</span>
                  <span className={isDarkMode?'text-gray-100':'text-primary'}>الكنز التعليمي</span>
                </div>
                <div className="text-[7px] sm:text-[9px] md:text-xs lg:text-sm font-bold flex gap-1 justify-center whitespace-nowrap">
                  <span className={isDarkMode ? "text-gray-200 font-bold" : "text-primary font-bold"}>رؤية وإعداد</span>
                  <span className="text-pink-600 font-black">أ/ إسلام سعود</span>
                </div>
              </div>
            </div>
            
            <div className={`flex items-center justify-center px-2 py-1 rounded-full shadow-inner border shrink-0 ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-100 border-gray-200'}`}>
              <div className={`font-black text-[10px] sm:text-sm md:text-lg lg:text-xl flex items-center gap-0.5 ${isDarkMode ? 'text-gray-300' : 'text-primary'}`} dir="ltr">
                <span className="text-secondary">{toEasternArabic(currentQIndex + 1)}</span>
                <span className="opacity-50">/</span>
                <span>{toEasternArabic(totalQs)}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0 justify-start sm:justify-end flex-nowrap overflow-x-auto custom-scrollbar pb-0.5 max-w-[45%]">
              {timeLeft !== null && timeLeft >= 0 && (
                <div className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 ${timeLeft < 60 ? 'bg-red-100 border-red-300 text-red-600 animate-pulse' : isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-orange-50 border-orange-200 text-orange-600'}`} dir="ltr">
                  <i className="fas fa-clock"></i>
                  <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
                </div>
              )}
              {timeLeft === -1 && (
                <div className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 bg-red-100 border-red-300 text-red-600 animate-pulse`} dir="ltr">
                  <i className="fas fa-clock"></i>
                  <span>انتهى الوقت</span>
                </div>
              )}
              {skippedQuestions.length > 0 && timeLeft !== -1 && (
                <button onClick={() => setShowSkippedModal(true)} className={`flex items-center justify-center px-2 py-1 md:px-3 md:py-1.5 rounded-full shadow-inner border shrink-0 font-black text-xs md:text-sm lg:text-base gap-1.5 animate-pulse ${isDarkMode ? 'bg-yellow-900/50 border-yellow-700 text-yellow-300' : 'bg-yellow-50 border-yellow-300 text-yellow-700'}`} dir="rtl">
                  <i className="fas fa-list-ul"></i>
                  <span>{toEasternArabic(skippedQuestions.length)} متروك</span>
                </button>
              )}
              <button onClick={toggleFullscreen} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isFullscreen?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className={`fas ${isFullscreen?'fa-compress':'fa-expand'}`}></i></button>
              <button onClick={()=>setIsDrawingMode(!isDrawingMode)} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isDrawingMode?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className="fas fa-pen"></i></button>
              <button onClick={()=>setIsDarkMode(!isDarkMode)} className={`w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-[10px] md:text-sm shrink-0 transition-colors ${isDarkMode?'bg-secondary text-white':'bg-gray-100 text-primary hover:bg-gray-200'}`}><i className={`fas ${isDarkMode?'fa-sun':'fa-moon'}`}></i></button>
              <button onClick={()=>showConfirm('هل أنت متأكد من مغادرة الاختبار؟\nسيتم حفظ تقدمك الحالي.', () => setScreen('index'))} className="w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 rounded-full bg-red-50 flex items-center justify-center text-[10px] md:text-sm shrink-0 text-red-600 hover:bg-red-500 hover:text-white transition-colors"><i className="fas fa-home"></i></button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 pb-28 z-10 flex flex-col pt-8">
            <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col mt-4">
              <div className={`rounded-3xl shadow-lg p-6 mb-8 relative border-2 mt-10 transition-all ${isDarkMode ? 'bg-gray-800 border-slate-500' : 'bg-[#fefee5] border-yellow-200/60'}`}>
                <div className="absolute -top-4 right-8 bg-secondary text-white font-bold px-4 py-1 rounded-full shadow">سؤال {toEasternArabic(currentQIndex+1)}</div>
                <h2 className={`text-xl sm:text-2xl font-bold mt-2 leading-relaxed ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  <FormatQuestionText text={question.q} concept={question.concept} isDarkMode={isDarkMode} />
                </h2>
              </div>
              
              {question.type === 'mcq' && (
                <div className="flex flex-col gap-4 mb-8">
                  {question.options.map((opt, idx) => {
                    let btnClass = isDarkMode
                      ? "bg-slate-800/80 border-2 border-slate-500 text-gray-100 p-4 rounded-2xl font-bold text-xl flex items-center shadow-sm cursor-pointer transition-all active:scale-95 hover:border-blue-400 hover:bg-slate-800"
                      : "bg-[#ebf5ff] border-2 border-[#bcccf0]/70 text-primary p-4 rounded-2xl font-bold text-xl flex items-center shadow-sm cursor-pointer transition-all active:scale-95 hover:border-blue-400 hover:bg-[#e1f0fe]";
                    if (isAnswered && currentAnswer) {
                      if (opt === question!.correct) {
                        btnClass = isDarkMode 
                          ? "bg-green-950/40 border-green-500 text-green-200 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2"
                          : "bg-green-50 border-green-500 text-green-800 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2";
                      } else if (currentAnswer.selected === opt) {
                        btnClass = isDarkMode
                          ? "bg-red-950/40 border-red-500 text-red-200 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2"
                          : "bg-red-50 border-red-500 text-red-800 p-4 rounded-2xl font-bold text-xl flex items-center shadow-md border-2";
                      } else {
                        btnClass = isDarkMode
                          ? "bg-gray-800/40 border-slate-700 text-gray-400 p-4 rounded-2xl font-bold text-xl flex items-center opacity-30 border-2"
                          : "bg-gray-50 border-gray-150 p-4 rounded-2xl font-bold text-xl flex items-center opacity-50 border-2";
                      }
                    }
                    return (
                      <button 
                        key={idx} 
                        onClick={()=>handleOptionClick(opt)} 
                        className={btnClass} 
                        disabled={isAnswered}
                      >
                        <span 
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg ml-4 shrink-0 transition-all ${
                            isAnswered && currentAnswer 
                              ? (opt === question!.correct 
                                  ? 'bg-green-500 text-white shadow-md' 
                                  : (currentAnswer.selected === opt 
                                      ? 'bg-red-500 text-white shadow-md' 
                                      : (isDarkMode 
                                          ? 'bg-gray-700 text-gray-300 opacity-50' 
                                          : 'bg-gray-100 text-gray-700 opacity-60')))
                              : 'bg-[#074ba3] text-white'
                          }`}
                          style={{
                            borderStyle: 'solid',
                            borderWidth: '1px',
                            borderColor: '#844d06',
                          }}
                        >
                          {['أ','ب','ج','د'][idx]}
                        </span>
                        <span className="text-right leading-relaxed whitespace-pre-line">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              
              {question.type === 'essay' && (
                <div className="mb-8 w-full text-center">
                  {!isAnswered ? (
                    <button onClick={handleEssayReveal} className="bg-primary text-white font-bold text-2xl py-6 px-12 rounded-2xl w-full max-w-lg shadow-lg active:scale-95 transition-transform">
                      الإجابة <i className="fas fa-eye ml-2"></i>
                    </button>
                  ) : (
                    <div className={`rounded-3xl p-6 border-r-8 border-green-500 text-right shadow-sm ${isDarkMode ? 'bg-green-950/20 text-gray-100' : 'bg-green-50'}`}>
                      <h3 className={`text-2xl font-black underline underline-offset-4 mb-4 ${isDarkMode ? 'text-red-400 decoration-red-400' : 'text-red-600 decoration-red-600'}`}>الإجابة:</h3>
                      <div className="text-xl font-bold leading-relaxed">
                        <HighlightText text={question.answer} concept={question.concept} isDarkMode={isDarkMode} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {isAnswered && currentAnswer && question.type === 'mcq' && question.reason && (
                <div className={`mt-4 rounded-3xl p-6 shadow-md border-r-8 ${
                  isDarkMode 
                    ? (currentAnswer.isCorrect ? 'bg-green-950/20 border-green-500 text-gray-100' : 'bg-red-950/20 border-red-500 text-gray-100')
                    : (currentAnswer.isCorrect ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500')
                }`}>
                  <h3 className={`text-xl font-black underline underline-offset-4 mb-2 ${isDarkMode ? 'text-red-400 decoration-red-400' : 'text-red-600 decoration-red-600'}`}>التعليل:</h3>
                  <div className="text-xl font-bold leading-relaxed">
                    <HighlightText text={question.reason} concept={question.concept} isDarkMode={isDarkMode} />
                  </div>
                </div>
              )}
              
              <div className="mt-auto pt-8 flex justify-between items-center bg-transparent z-10">
                {/* مساحة فارغة بدلاً من زر السابق للحفاظ على التنسيق ومنع الرجوع بالخطأ */}
                <div className="w-24"></div>

                {!isAnswered && currentQIndex < totalQs - 1 && timeLeft !== -1 && (
                  <button
                    onClick={handleSkip}
                    className={`font-black text-lg py-3 px-6 rounded-2xl transition-transform active:scale-95 shadow-md flex items-center gap-2 ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
                  >
                    تخطي <i className="fas fa-forward"></i>
                  </button>
                )}

                {isAnswered ? (
                  <button 
                    onClick={()=>currentQIndex<totalQs-1?setCurrentQIndex(currentQIndex+1):handleFinishQuiz()} 
                    className={`text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95 ${currentQIndex===totalQs-1?'bg-red-500':'bg-secondary'}`}
                  >
                    {currentQIndex===totalQs-1?'إنهاء':'التالي'} <i className="fas fa-arrow-left"></i>
                  </button>
                ) : (
                  currentQIndex === totalQs - 1 && (
                    <button 
                      onClick={handleFinishQuiz} 
                      className="text-white font-black text-xl py-3 px-8 rounded-2xl shadow-md transition-transform active:scale-95 bg-red-500"
                    >
                      إنهاء الاختبار
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
          
          {/* Skipped Questions Modal */}
          <AnimatePresence>
            {showSkippedModal && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4 backdrop-blur-sm" 
                dir="rtl"
              >
                <motion.div 
                  initial={{ scale: 0.9, y: 20, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  exit={{ scale: 0.9, y: 20, opacity: 0 }}
                  className={`rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl flex flex-col border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className={`text-xl font-black ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>
                      <i className="fas fa-list-ul ml-2 text-yellow-500"></i>
                      الأسئلة المتروكة
                    </h2>
                    <button onClick={() => setShowSkippedModal(false)} className={`text-2xl transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}>
                      <i className="fas fa-times-circle"></i>
                    </button>
                  </div>
                  <p className={`text-sm font-bold mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    لا تقلق، يتم حفظ الأسئلة التي قمت بتخطيها هنا، اضغط على رقم السؤال للعودة إليه:
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                    {skippedQuestions.map((qIdx) => (
                      <button
                        key={qIdx}
                        onClick={() => {
                          setCurrentQIndex(qIdx);
                          setShowSkippedModal(false);
                        }}
                        className={`aspect-square rounded-xl font-black text-lg flex items-center justify-center shadow-sm transition-transform active:scale-95 border-2 ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-gray-50 border-gray-200 text-primary hover:bg-gray-200'}`}
                      >
                        {toEasternArabic(qIdx + 1)}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Feedback Toast Overlay */}
          <AnimatePresence>
            {feedbackToast && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 z-[99999] flex items-center justify-center backdrop-blur-xs"
              >
                <motion.div 
                  initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1, transition: { type: 'spring', damping: 12 } }}
                  exit={{ scale: 0.6, rotate: 10, opacity: 0, transition: { duration: 0.2 } }}
                  className={`px-8 py-6 rounded-3xl flex flex-col items-center justify-center gap-2 shadow-[0_25px_60px_rgba(0,0,0,0.5)] border-4 transition-all ${
                    feedbackToast.isCorrect 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800' 
                      : 'bg-rose-50 border-rose-500 text-rose-800'
                  }`}
                >
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-[2.75rem] shadow-sm border-2 ${
                    feedbackToast.isCorrect 
                      ? 'bg-emerald-500 text-white border-emerald-600 animate-bounce' 
                      : 'bg-rose-500 text-white border-rose-600'
                  }`}>
                    {feedbackToast.isCorrect ? '👍' : '😔'}
                  </div>
                  <span className="text-2xl font-black mt-1 select-none tracking-wide text-center">
                    {feedbackToast.isCorrect ? 'عاش 💪' : 'ركز'}
                  </span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );
    }
    
    if (screen === 'result' && activeLesson) {
      const totalQs = activeLesson.questions.length; 
      const correct = userAnswers.filter(a => a.isCorrect).length; 
      const perc = Math.round((correct/totalQs)*100);
      const wrongConcepts = [...new Set(userAnswers.filter(a => !a.isCorrect).map(a => a.paragraph || a.concept || 'مراجعة عامة'))];
      const firstName = studentName ? studentName.split(' ')[0] : 'يا بطل';
      const earnedXP = correct * 10;
      
      // حساب نسبة استكمال الوحدة والدرجة الإجمالية
      const activeUnit = data.find(u => u.lessons.some(l => l.id === activeLesson.id));
      let totalUnitQs = 0;
      let totalUnitCorrect = 0;
      let allLessonsAttempted = true;

      if (activeUnit) {
        activeUnit.lessons.forEach(l => {
          totalUnitQs += l.questions.length;
          if (l.id === activeLesson.id) {
             const firstAttemptScore = lessonScores[l.id] !== undefined ? lessonScores[l.id] : correct;
             totalUnitCorrect += Math.min(l.questions.length, firstAttemptScore);
          } else {
             if (lessonScores[l.id] !== undefined) {
                totalUnitCorrect += Math.min(l.questions.length, lessonScores[l.id]);
             } else {
                allLessonsAttempted = false;
             }
          }
        });
      }
      const unitPerc = totalUnitQs > 0 ? Math.min(100, Math.round((totalUnitCorrect / totalUnitQs) * 100)) : 0;
      const showUnitCert = allLessonsAttempted && unitPerc >= 90 && activeLesson.id !== 'mistakes_bank';

      return (
        <div className="h-[100dvh] w-full flex items-center justify-center p-6 bg-gray-50 overflow-y-auto watermark-container">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8 md:p-10 text-center border-t-8 border-primary my-auto animate-fade-in flex flex-col items-center">
            <i className={`fas ${perc===100?'fa-trophy text-gold':perc>=75?'fa-medal text-blue-500':'fa-book-open text-secondary'} text-7xl md:text-8xl mb-4 block`}></i>
            <div className="text-5xl md:text-6xl font-black text-primary mb-6 flex justify-center items-center gap-1" dir="ltr"><span>{toEasternArabic(perc)}</span><span>%</span></div>
            <div className="w-full mb-8">
              
              {earnedXP > 0 && activeLesson.id !== 'mistakes_bank' && (
                <div className="flex flex-col items-center gap-2 mb-6">
                  <div className="bg-yellow-100 text-yellow-800 font-black px-4 py-2 rounded-xl text-lg shadow-sm border border-yellow-300 inline-block">
                    +{toEasternArabic(earnedXP)} نقطة خبرة (XP) 🌟
                  </div>
                  <div className="bg-indigo-50 text-indigo-800 font-bold px-4 py-2 rounded-xl text-sm shadow-sm border border-indigo-200 w-full">
                    مستواك الحالي: {levelInfo.icon} <span className="font-black">{levelInfo.title}</span>
                  </div>
                  {badges.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mt-2 w-full">
                      {badges.includes('mistake_conqueror') && <div className="bg-slate-50 border border-slate-300 text-slate-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">🛡️ قاهر الأخطاء</div>}
                      {badges.includes('night_owl') && <div className="bg-indigo-50 border border-indigo-300 text-indigo-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">🦉 بطل الليل</div>}
                      {badges.includes('perfect_arrow') && <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 px-3 py-1.5 rounded-xl text-xs font-black shadow-sm">⚡ وسام السهم</div>}
                    </div>
                  )}
                </div>
              )}
              
              {showUnitCert && (
                <div className="space-y-4 mb-4">
                  <button
                    onClick={() => setShowCertModal(true)}
                    className="bg-gradient-to-r from-yellow-400 to-yellow-600 text-white font-black text-lg sm:text-xl py-3.5 px-6 rounded-2xl w-full hover:from-yellow-500 hover:to-yellow-700 transition-all shadow-lg border-2 border-yellow-300 animate-pulse flex items-center justify-center gap-3 cursor-pointer"
                  >
                    <i className="fas fa-award text-2xl"></i> استلام شهادة إتمام الوحدة 📜
                  </button>
                </div>
              )}

              {perc === 100 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-pink-600 font-black">عاش يا بطل!</span> لقد اجتزت (<span className="text-secondary font-black">{activeLesson.title}</span>) بنجاح.</p>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-lg font-black text-blue-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، أنا فخور بك!</p></div>
                </div>
              )}
              {perc >= 75 && perc < 100 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-pink-600 font-black">عاش يا بطل!</span> لقد اجتزت (<span className="text-secondary font-black">{activeLesson.title}</span>) بنجاح.<span className="text-gray-600 mt-2 block text-lg">ولكن لضمان التقفيل، راجع هذه الأجزاء السريعة:</span><span className="text-primary block mt-1 font-black text-lg">({wrongConcepts.join('، ')})</span></p>
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-lg font-black text-blue-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، أنا فخور بك!</p></div>
                </div>
              )}
              {perc < 75 && (
                <div className="space-y-4">
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-loose"><span className="text-red-500 block mb-1">هناك أجزاء تحتاج تركيز:</span><span className="text-primary font-black block text-lg">({wrongConcepts.join('، ')})</span></p>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 shadow-sm inline-block w-full"><p className="text-base md:text-lg font-black text-yellow-800"><span className="text-pink-600">أ/ إسلام سعود:</span> {firstName}، لا تنسَ مراجعة ما سبق، في كل الأحوال سوف أكون فخور بك بإذن الله ❤️</p></div>
                </div>
              )}
            </div>
            <div className="w-full flex flex-col gap-3">
              <button 
                onClick={()=>{
                  setScreen('index');
                }} 
                className="bg-primary text-white font-black text-xl md:text-2xl py-4 px-10 rounded-full w-full hover:bg-gray-900 transition-colors shadow-lg active:scale-95"
              >
                العودة للفهرس
              </button>
              
              {perc < 100 && (
                <button 
                  onClick={()=>{
                    const wrongQs = activeLesson.questions.filter((q, idx) => userAnswers[idx] && !userAnswers[idx].isCorrect);
                    const shuffledWrongQs = shuffleArray(wrongQs).map(q => {
                      if (q.type === 'mcq' && q.options && q.options.length > 0) {
                        return { ...q, options: shuffleOptions(q.options) };
                      }
                      return q;
                    });
                    const newLesson = { ...activeLesson, questions: shuffledWrongQs };
                    setData(data.map(u=>({...u,lessons:u.lessons.map(l=>l.id===activeLesson.id?newLesson:l)})));
                    setActiveLesson(newLesson);
                    setUserAnswers([]);
                    setCurrentQIndex(0);
                    setSkippedQuestions([]);
                    setTimeLeft(getInitialTimeLeft(activeLesson.title, activeLesson.id, shuffledWrongQs.length));
                    setScreen('quiz');
                  }} 
                  className="bg-rose-500 text-white font-black text-xl md:text-2xl py-4 px-10 rounded-full w-full hover:bg-rose-700 transition-colors shadow-lg active:scale-95 border-2 border-rose-600"
                >
                  إعادة اختبار الأخطاء فقط <i className="fas fa-redo-alt ml-2"></i>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    if (screen === 'admin') {
      const calculateAdminCertificates = () => {
        const certStudents: { name: string; phone: string; avg: number; unitTitle: string; totalScore?: number }[] = [];
        
        const unitsToProcess = adminSelectedUnit === 'all' 
          ? [] // تتم معالجة "الكل" بشكل مستقل
          : data.filter(u => u.id === adminSelectedUnit);
      
        if (adminSelectedUnit !== 'all' && unitsToProcess.length === 0) return [];
        
        const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
        
        adminResults.forEach(student => {
          const firstScores: Record<string, number> = {};
          
          student.tests.forEach(t => {
            if (isAmbiguousOldQuiz(t.quiz)) return;
            
            if (t.quiz.includes('تصفير') || String(t.score).includes('تصفير')) {
              if (t.quiz.includes('تصفير الوحدة')) { 
                const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                if (unitToReset) {
                    unitToReset.lessons.forEach(l => delete firstScores[l.title]);
                }
              }
              else {
                for(let key in firstScores) delete firstScores[key];
              }
              return;
            }
            
            const mappedTitle = matchQuizToCurrent(t.quiz, currentValidLessons);
            if (mappedTitle) {
                  const sc = normalizeScore(t.score);
                  if (firstScores[mappedTitle] === undefined) {
                    firstScores[mappedTitle] = sc;
                  }
            }
          });

          if (adminSelectedUnit === 'all') {
            let totalPerc = 0;
            let attemptedCount = 0;
            
            currentValidLessons.forEach(lTitle => {
              if (firstScores[lTitle] !== undefined) {
                attemptedCount++;
                totalPerc += firstScores[lTitle];
              }
            });
            
            if (attemptedCount > 0) {
               const overallAvg = Math.min(100, Math.round(totalPerc / attemptedCount));
               certStudents.push({ 
                 name: student.name, 
                 phone: student.phone, 
                 avg: overallAvg, 
                 unitTitle: `شامل (${toEasternArabic(attemptedCount)} دروس)`,
                 totalScore: totalPerc
               });
            }
          } else {
            unitsToProcess.forEach(selectedUnitObj => {
              let allLessonsAttempted = true;
              let totalPerc = 0;

              selectedUnitObj.lessons.forEach(l => {
                if (firstScores[l.title] === undefined) {
                  allLessonsAttempted = false;
                } else {
                  totalPerc += firstScores[l.title];
                }
              });
        
              if (allLessonsAttempted && selectedUnitObj.lessons.length > 0) {
                const unitAvg = Math.min(100, Math.round(totalPerc / selectedUnitObj.lessons.length));
                if (unitAvg >= 90) {
                  certStudents.push({ name: student.name, phone: student.phone, avg: unitAvg, unitTitle: selectedUnitObj.title, totalScore: totalPerc });
                }
              }
            });
          }
        });
      
        if (adminSelectedUnit === 'all') {
          return certStudents.sort((a, b) => {
            if (b.totalScore !== a.totalScore) return (b.totalScore || 0) - (a.totalScore || 0);
            return b.avg - a.avg;
          });
        } else {
          return certStudents.sort((a, b) => b.avg - a.avg);
        }
      };

      const formatAdminQuizName = (name: string) => {
        if (!name) return null;
        const regex = /(الوحدة\s+[\u0600-\u06FF]+|الدرس\s+[\u0600-\u06FF]+|تصفير\s*[^:]*|بنك الأخطاء\s*[^\s:]*)/g;
        const parts = name.split(regex);
        return parts.map((part, idx) => {
          if (part.startsWith('الوحدة')) return <span key={idx} className="text-rose-600 font-black">{part}</span>;
          if (part.startsWith('الدرس')) return <span key={idx} className="text-emerald-600 font-black">{part}</span>;
          if (part.startsWith('تصفير')) return <span key={idx} className="text-red-600 font-black">{part}</span>;
          if (part.startsWith('بنك الأخطاء')) return <span key={idx} className="text-rose-500 font-black">{part}</span>;
          return <span key={idx} className="text-indigo-600 font-black">{part}</span>;
        });
      };

      return (
        <div className="h-[100dvh] w-full flex flex-col bg-gray-50 watermark-container">
          <div className="bg-primary text-white px-4 pt-3 md:pt-4 lg:pt-3 pb-3 flex justify-between items-center z-10 border-b-4 border-gold flex-wrap gap-y-3 shadow-md shrink-0">
            <div className="flex items-center gap-3 shrink-0 justify-start">
              <i className="fas fa-graduation-cap text-2xl sm:text-3xl md:text-4xl text-gold shrink-0"></i>
              <div className="flex flex-col items-start text-right">
                <div className="flex items-center gap-1 font-black text-xl sm:text-2xl leading-none mb-1"><span className="text-gold">موسوعة</span><span className="text-white">الكنز التعليمي</span></div>
                <div className="text-[10px] sm:text-xs font-bold flex gap-1"><span className="text-gray-300">الإدارة</span></div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 shrink-0">
              <button onClick={() => setScreen('index')} className="bg-blue-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-blue-500 transition-all shadow-sm border border-blue-500 flex items-center gap-2"><i className="fas fa-book-reader"></i> طالب</button>
              <button onClick={fetchAdminData} className="bg-emerald-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-emerald-500 transition-all shadow-sm border border-emerald-500 flex items-center gap-2"><i className="fas fa-sync-alt"></i> تحديث</button>
              <button onClick={() => { setInputPhone(''); setInputPassword(''); setShowPasswordInput(false); setScreen('home'); }} className="bg-rose-600 text-white font-black px-4 py-2 rounded-xl text-xs sm:text-sm hover:bg-rose-500 transition-all shadow-sm border border-rose-500 flex items-center gap-2"><i className="fas fa-sign-out-alt"></i> خروج</button>
            </div>
          </div>
          
          <div 
            className="flex-1 overflow-y-auto p-4 z-10 flex flex-col md:flex-row gap-6"
            ref={adminScrollRef}
            onScroll={(e) => setShowAdminScrollTop(e.currentTarget.scrollTop > 300)}
          >
            <div className="w-full md:w-64 shrink-0 bg-white rounded-2xl shadow-sm border border-gray-100 p-2.5 flex flex-row md:flex-col overflow-x-auto custom-scrollbar gap-2">
              <button onClick={() => setAdminActiveTab('results')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='results'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-chart-bar w-5 text-center"></i> النتائج والمتابعة</button>
              <button onClick={() => setAdminActiveTab('lessons')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='lessons'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-layer-group w-5 text-center text-emerald-500"></i> إدارة ونشر الدروس</button>
              <button onClick={() => setAdminActiveTab('leaderboard')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='leaderboard'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-trophy w-5 text-center text-gold"></i> لوحة الشرف</button>
              <button onClick={() => setAdminActiveTab('certificates')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='certificates'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-award w-5 text-center text-blue-400"></i> شهادات التقدير</button>
              <button onClick={() => setAdminActiveTab('requests')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 relative ${adminActiveTab==='requests'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-user-clock w-5 text-center"></i> الطلبات {adminPendingReqs.length>0&&<span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse">{adminPendingReqs.length}</span>}</button>
              <button onClick={() => setAdminActiveTab('search')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='search'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-search-dollar w-5 text-center"></i> الاشتراكات</button>
              <button onClick={() => setAdminActiveTab('settings')} className={`px-4 py-3 rounded-xl font-black text-sm whitespace-nowrap text-right transition-all flex items-center gap-2.5 ${adminActiveTab==='settings'?'bg-primary text-white shadow-md':'text-gray-600 bg-gray-50 border border-transparent hover:bg-gray-100 border-gray-200'}`}><i className="fas fa-cog w-5 text-center"></i> الإعدادات</button>
            </div>
            
            <div className="flex-1 w-full space-y-6 min-w-0">
              {adminActiveTab === 'results' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                      <h2 className="text-xl font-black text-primary"><i className="fas fa-chart-line text-blue-500 ml-1"></i> نتائج ومتابعة الطلاب</h2>
                      <div className="relative w-full sm:w-64">
                        <input 
                          type="text" 
                          placeholder="بحث بالاسم..." 
                          className="border-2 border-gray-300 rounded-xl px-4 py-2 w-full focus:border-primary outline-none text-sm font-bold pr-10" 
                          value={resultsSearchQuery} 
                          onChange={e => setResultsSearchQuery(e.target.value)} 
                        />
                        <i className="fas fa-search absolute top-1/2 -translate-y-1/2 right-3 text-gray-400"></i>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button onClick={() => setAdminSort('alpha')} className={`flex-1 min-w-[90px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 ${adminSort === 'alpha' ? 'bg-blue-600 border-blue-700 text-white shadow-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-blue-300'}`}><i className="fas fa-sort-alpha-down"></i> الأبجدية</button>
                      <button onClick={() => setAdminSort('most')} className={`flex-1 min-w-[90px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 ${adminSort === 'most' ? 'bg-emerald-600 border-emerald-700 text-white shadow-emerald-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-emerald-300'}`}><i className="fas fa-fire"></i> تفاعلاً</button>
                      <button onClick={() => setAdminSort('least')} className={`flex-1 min-w-[90px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 ${adminSort === 'least' ? 'bg-orange-500 border-orange-600 text-white shadow-orange-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-orange-300'}`}><i className="fas fa-battery-quarter"></i> تكاسلاً</button>
                      <button onClick={() => setAdminSort('none')} className={`flex-1 min-w-[90px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 ${adminSort === 'none' ? 'bg-rose-600 border-rose-700 text-white shadow-rose-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-rose-300'}`}><i className="fas fa-ghost"></i> لم يدخلوا</button>
                      <button onClick={() => setAdminSort('blocked')} className={`flex-1 min-w-[90px] px-3 py-2 rounded-xl text-xs sm:text-sm font-black shadow-sm transition-all flex justify-center items-center gap-1.5 border-2 ${adminSort === 'blocked' ? 'bg-gray-900 border-black text-white shadow-gray-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-900'}`}><i className="fas fa-user-lock"></i> المحظورين</button>
                    </div>
                  </div>
                  <div className="p-4 space-y-2">
                    {(() => {
                      const currentValidLessons = data.flatMap(u => u.lessons.map(l => l.title));
                      const reqKeywords = ['زراع', 'رع', 'تعدين', 'صناع', 'يولي', 'فلسطين', 'كتوبر', 'صراع', 'يناير'];
                      const requiredCurrentTitles = currentValidLessons.filter(title => 
                          reqKeywords.some(kw => normalizeLessonName(title).includes(normalizeLessonName(kw)))
                      );
                      
                      const getUniqueActiveTests = (tests: TestResult[]) => {
                          if (!tests || tests.length === 0) return [];
                          const firstScores: Record<string, number> = {};
                          tests.forEach(t => {
                              if (isAmbiguousOldQuiz(t.quiz)) return;
                              if (t.quiz.includes('تصفير') || String(t.score).includes('تصفير')) {
                                  if (t.quiz.includes('تصفير الوحدة')) { 
                                      const unitTitleToReset = t.quiz.replace(/.*تصفير الوحدة.*?:/, '').trim();
                                      const unitToReset = data.find(u => normalizeLessonName(u.title) === normalizeLessonName(unitTitleToReset));
                                      if (unitToReset) {
                                          unitToReset.lessons.forEach(l => delete firstScores[l.title]);
                                      }
                                  } else {
                                      for(let key in firstScores) delete firstScores[key];
                                  }
                                  return;
                              }
                              const mappedTitle = matchQuizToCurrent(t.quiz, currentValidLessons);
                              if (mappedTitle && firstScores[mappedTitle] === undefined) {
                                  firstScores[mappedTitle] = normalizeScore(t.score);
                              }
                          });
                          return Object.keys(firstScores);
                      };

                      let list = [...adminResults];
                      const activeNames = new Set(adminResults.map(r => r.name ? r.name.trim() : ''));
                      const inactive: GroupedResult[] = [];
                      Object.entries(studentsList).forEach(([phone, arr]) => {
                        const stArr = Array.isArray(arr) ? arr : [arr];
                        stArr.forEach(st => {
                           if (st && st.name && !activeNames.has(st.name.trim())) {
                             inactive.push({ name: st.name, phone: phone, tests: [] });
                           }
                        });
                      });

                      const testCountMap = new Map<any, number>();
                      const getCount = (st: GroupedResult) => {
                        let c = testCountMap.get(st);
                        if (c === undefined) {
                          c = getUniqueActiveTests(st.tests).length;
                          testCountMap.set(st, c);
                        }
                        return c;
                      };

                      let baseList = [...list, ...inactive];
                      if (adminSort === 'none') {
                         baseList = inactive.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      } else if (adminSort === 'most') {
                         baseList = list.sort((a,b) => getCount(b) - getCount(a));
                      } else if (adminSort === 'least') {
                         baseList = list.sort((a,b) => getCount(a) - getCount(b));
                      } else if (adminSort === 'blocked') {
                         baseList = baseList.filter(s => {
                             const stRecord = studentsList[s.phone];
                             const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                             const matchedSt = stArr.find(st => st.name.trim() === (s.name || '').trim());
                             return matchedSt && (matchedSt as any).isBlocked;
                         }).sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      } else {
                         baseList = list.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'ar'));
                      }

                      let displayList: GroupedResult[] = [];
                      if (resultsSearchQuery.trim()) {
                        const q = resultsSearchQuery.trim().toLowerCase();
                        displayList = baseList.filter(s => 
                          (s.name && String(s.name).toLowerCase().includes(q)) || 
                          (s.phone && String(s.phone).includes(q))
                        );
                      } else {
                        displayList = baseList;
                      }

                      const getNameColor = (testsCount: number) => {
                          if (testsCount === 0) return 'text-rose-600';
                          if (testsCount > 5) return 'text-emerald-700';
                          return 'text-blue-700';
                      };
                      
                      let defaultColorClass = 'text-blue-700';
                      if (adminSort === 'most') defaultColorClass = 'text-emerald-700';
                      else if (adminSort === 'least') defaultColorClass = 'text-orange-600';
                      else if (adminSort === 'none') defaultColorClass = 'text-rose-600';
                      else if (adminSort === 'blocked') defaultColorClass = 'text-gray-900';
                      
                      const canShowActionsBase = adminSort === 'none' || adminSort === 'blocked';

                      return (
                        <React.Fragment>
                          {adminSort === 'none' && (
                            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 bg-rose-50 border border-rose-200 p-3 rounded-xl gap-3 shadow-sm">
                              <span className="text-rose-800 font-black text-sm">
                                <i className="fas fa-ghost ml-1"></i>
                                إجمالي غير المتفاعلين: {toEasternArabic(displayList.length)}
                              </span>
                              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                <button 
                                  onClick={() => {
                                    const inactiveToBlock = displayList.filter(s => {
                                      if (getUniqueActiveTests(s.tests).length > 0) return false;
                                      const stRecord = studentsList[s.phone];
                                      const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                                      const matchedSt = stArr.find(student => student.name.trim() === (s.name || '').trim());
                                      return matchedSt && !(matchedSt as any).isBlocked;
                                    });

                                    if (inactiveToBlock.length === 0) {
                                      showAlert('لا يوجد طلاب غير متفاعلين (وغير محظورين مسبقاً) لحظرهم.');
                                      return;
                                    }
                                    showConfirm(`هل أنت متأكد من حظر الطلاب غير المتفاعلين (وعددهم ${inactiveToBlock.length} طالب) دفعة واحدة؟\n(لن يتم حظر أي طالب متفاعل أو محظور مسبقاً).`, async () => {
                                      setIsLoading(true);
                                      setStudentsList(prev => {
                                        const newList = { ...prev };
                                        inactiveToBlock.forEach(st => {
                                          if (newList[st.phone]) {
                                            const listArr = Array.isArray(newList[st.phone]) ? newList[st.phone] : [newList[st.phone]];
                                            newList[st.phone] = (listArr as Student[]).map(s => 
                                              s.name.trim() === (st.name || '').trim() ? { ...s, isBlocked: true } as unknown as Student : s
                                            );
                                          }
                                        });
                                        return newList;
                                      });
                                      
                                      try {
                                        const studentsPayload = inactiveToBlock.map(st => ({ phone: st.phone, name: st.name }));
                                        await fetch(API_URL, { 
                                          method: 'POST', 
                                          body: JSON.stringify({ action: 'blockMultipleStudents', students: studentsPayload, apiKey: SECRET_API_KEY }) 
                                        });
                                      } catch(e) {}
                                      
                                      setIsLoading(false);
                                      showAlert('تم حظر جميع الطلاب غير المتفاعلين بنجاح! 🚫');
                                    });
                                  }}
                                  className="flex-1 sm:flex-none bg-rose-600 text-white hover:bg-rose-700 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95"
                                >
                                  <i className="fas fa-user-slash"></i> حظر جماعي
                                </button>
                                <button 
                                  onClick={() => {
                                    if(displayList.length === 0) { showAlert('لا توجد أسماء لنسخها.'); return; }
                                    const text = displayList.map((s, idx) => `${idx + 1}- ${s.name}`).join('\n');
                                    navigator.clipboard.writeText(text);
                                    showAlert('تم نسخ قائمة الأسماء بنجاح! يمكنك الآن لصقها في أي مكان.');
                                  }}
                                  className="flex-1 sm:flex-none bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-black shadow-sm flex justify-center items-center gap-2 transition-all active:scale-95"
                                >
                                  <i className="fas fa-copy"></i> نسخ الأسماء
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {adminSort === 'blocked' && (
                            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 bg-gray-100 border border-gray-300 p-3 rounded-xl gap-3 shadow-sm">
                              <span className="text-gray-800 font-black text-sm">
                                <i className="fas fa-user-lock ml-1"></i>
                                إجمالي الطلاب المحظورين: {toEasternArabic(displayList.length)}
                              </span>
                            </div>
                          )}
                          
                          {displayList.length > 0 ? displayList.slice(0, adminResultsLimit).map((student, i) => {
                            const realTestCount = getCount(student);
                            
                            const stRecord = studentsList[student.phone];
                            const stArr = stRecord ? (Array.isArray(stRecord) ? stRecord : [stRecord]) : [];
                            const matchedSt = stArr.find(s => s.name.trim() === student.name.trim());
                            const isBlocked = matchedSt ? (matchedSt as any).isBlocked : false;
                            
                            const isRevealed = revealedBlockStudents.includes(student.phone);
                            const canShowActions = canShowActionsBase || isRevealed || isBlocked;

                            return (
                            <div key={i} className={`border ${isBlocked ? 'border-red-300' : 'border-gray-200'} rounded-xl overflow-hidden`}>
                              <div onClick={() => setExpandedAdminStudent(expandedAdminStudent === student.name ? null : student.name)} className={`${isBlocked ? 'bg-red-50' : 'bg-gray-50'} px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors`}>
                                <div className="flex-1 min-w-0 pr-2 pl-2 flex items-center gap-2">
                                  <div 
                                    className={`font-black text-sm ${resultsSearchQuery.trim() ? getNameColor(realTestCount) : defaultColorClass} truncate select-none`} 
                                    title={student.name}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const now = Date.now();
                                      const data = studentClickData.current[student.phone] || { count: 0, time: 0 };
                                      if (now - data.time < 600) data.count += 1; else data.count = 1;
                                      data.time = now;
                                      studentClickData.current[student.phone] = data;
                                      if (data.count === 3) {
                                        setRevealedBlockStudents(prev => prev.includes(student.phone) ? prev.filter(p => p !== student.phone) : [...prev, student.phone]);
                                        data.count = 0;
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const now = Date.now();
                                      const data = studentClickData.current[student.phone] || { count: 0, time: 0 };
                                      if (now - data.time < 600) data.count += 1; else data.count = 1;
                                      data.time = now;
                                      studentClickData.current[student.phone] = data;
                                      if (data.count === 3) {
                                        setRevealedBlockStudents(prev => prev.includes(student.phone) ? prev.filter(p => p !== student.phone) : [...prev, student.phone]);
                                        data.count = 0;
                                      }
                                    }}
                                  >
                                    {student.name}
                                  </div>
                                  {canShowActions ? (
                                    isBlocked ? (
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleUnblockStudent(student.phone, student.name); }} 
                                        className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-black shadow-sm transition-colors flex items-center gap-1 active:scale-95 shrink-0"
                                        title="فك الحظر عن الطالب"
                                      >
                                        <i className="fas fa-unlock"></i> فك الحظر
                                      </button>
                                    ) : (
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleBlockStudent(student.phone, student.name); }} 
                                        className="bg-white text-rose-600 hover:bg-rose-100 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-black transition-colors flex items-center gap-1 active:scale-95 shrink-0"
                                        title="حظر الطالب"
                                      >
                                        <i className="fas fa-ban"></i> حظر
                                      </button>
                                    )
                                  ) : (
                                    isBlocked ? (
                                      <span className="bg-red-500 text-white px-2 py-0.5 rounded text-[10px] font-black shadow-sm flex items-center gap-1 shrink-0" title="هذا الطالب محظور">
                                        <i className="fas fa-lock"></i> محظور
                                      </span>
                                    ) : null
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`${realTestCount === 0 ? 'bg-red-100 text-red-800' : realTestCount > 5 ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap`}>
                                    {realTestCount === 0 ? 'لم يتفاعل' : `${toEasternArabic(realTestCount)} اختبارات`}
                                  </span>
                                  <i className={`fas fa-chevron-${expandedAdminStudent === student.name ? 'up' : 'down'} text-gray-400 text-xs`}></i>
                                </div>
                              </div>
                              {expandedAdminStudent === student.name && (
                                <div className="divide-y divide-gray-100">
                                  <div className="px-4 py-2 bg-gray-100/50 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-600">هاتف: <span dir="ltr">{student.phone}</span></span>
                                    <div className="flex items-center gap-2">
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleResetDevice(student.phone, student.name); }}
                                        className="bg-purple-100 text-purple-700 hover:bg-purple-200 px-2 py-1 rounded text-[10px] font-black shadow-sm transition-colors flex items-center gap-1 active:scale-95 shrink-0"
                                        title="السماح للطالب بالدخول من جهاز جديد"
                                      >
                                        <i className="fas fa-mobile-alt"></i> فك الجهاز
                                      </button>
                                      {student.tests && student.tests.length > 0 && <span className="text-[10px] text-gray-500">آخر تفاعل: {(student.tests[student.tests.length - 1].date || '').split(',')[0]}</span>}
                                    </div>
                                  </div>
                                  {(() => {
                                    const uniqueQuizzes = getUniqueActiveTests(student.tests);
                                    
                                    const missingRequired = requiredCurrentTitles.filter(reqTitle => 
                                        !uniqueQuizzes.includes(reqTitle)
                                    );
                                    
                                    if (missingRequired.length > 0 && uniqueQuizzes.length > 0) {
                                      return (
                                        <div className="px-4 py-3 bg-rose-50 border-b border-gray-100 flex flex-col gap-2">
                                          <span className="text-xs font-black text-rose-700"><i className="fas fa-exclamation-triangle"></i> نواقص لوحة الشرف ({missingRequired.length}):</span>
                                          <div className="flex flex-wrap gap-1">
                                            {missingRequired.map((m, mIdx) => <span key={mIdx} className="bg-white border border-rose-200 text-rose-600 px-2 py-1 rounded text-[10px] font-bold shadow-sm">{m}</span>)}
                                          </div>
                                        </div>
                                      );
                                    } else if (missingRequired.length === 0 && uniqueQuizzes.length > 0) {
                                      return (
                                        <div className="px-4 py-2 bg-emerald-50 border-b border-gray-100 flex items-center gap-2">
                                          <span className="text-xs font-black text-emerald-700"><i className="fas fa-check-circle"></i> مؤهل للوحة الشرف بامتياز</span>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                  {student.tests && student.tests.length > 0 ? [...student.tests].reverse().map((test, tIdx) => {
                                    const normalizedScore = normalizeScore(test.score);
                                    const isGood = normalizedScore >= 75;
                                    return (
                                      <div key={tIdx} className="px-4 py-3 flex justify-between items-center bg-white">
                                        <div className="flex flex-col min-w-0 pr-2">
                                          <span className="text-sm truncate">{formatAdminQuizName(test.quiz)}</span>
                                          <span className="text-[10px] text-gray-400">{test.date || ''}</span>
                                        </div>
                                        <span className={`${isGood ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} px-2 py-1 rounded-lg font-black text-xs shrink-0`}>{toEasternArabic(normalizedScore)}٪</span>
                                      </div>
                                    );
                                  }) : (
                                    <div className="px-4 py-4 text-center text-sm text-gray-500 font-bold bg-white">لم يقم بحل أي اختبارات حتى الآن.</div>
                                  )}
                                </div>
                              )}
                            </div>
                            );
                          }) : <div className="text-center text-gray-500 font-bold py-8">لا توجد بيانات لهذه الفئة.</div>}
                          
                          {displayList.length > adminResultsLimit && (
                            <div className="flex flex-wrap justify-center items-center gap-3 pt-4 pb-2">
                              <button 
                                onClick={() => setAdminResultsLimit(prev => prev + 50)}
                                className="bg-primary/10 hover:bg-primary/20 text-primary font-black text-sm px-5 py-2.5 rounded-xl border border-primary/30 transition-all flex items-center gap-2 active:scale-95 shadow-sm"
                              >
                                <i className="fas fa-plus-circle"></i> عرض ٥٠ طالب إضافي (متبقي {toEasternArabic(displayList.length - adminResultsLimit)})
                              </button>
                              <button 
                                onClick={() => setAdminResultsLimit(displayList.length)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-4 py-2.5 rounded-xl border border-gray-300 transition-all active:scale-95"
                              >
                                عرض الكل ({toEasternArabic(displayList.length)})
                              </button>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })()}
                  </div>
                </div>
              )}
              {adminActiveTab === 'lessons' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h2 className="text-xl font-black text-primary flex items-center gap-2">
                        <i className="fas fa-layer-group text-emerald-600"></i> إدارة تفعيل ونشر الدروس للطلاب
                      </h2>
                      <p className="text-xs text-gray-500 font-bold mt-1">
                        تحكم في إظهار أو إخفاء الدروس للاختبارات ولوحة الشرف بضغطة زر واحدة.
                      </p>
                    </div>
                    <button
                      onClick={handleSavePublishedLessons}
                      disabled={isSavingLessons}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-5 py-2.5 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2 shrink-0"
                    >
                      <i className={isSavingLessons ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-up"}></i>
                      حفظ وتحديث للطلاب 🚀
                    </button>
                  </div>

                  <div className="p-4 space-y-6">
                    {/* إحصائيات سريعة للدروس */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-blue-600 font-bold block mb-1">إجمالي الدروس بالإكسيل</span>
                        <span className="text-xl font-black text-blue-800">{lessonStats.total}</span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-emerald-600 font-bold block mb-1">الدروس المنشورة حالياً</span>
                        <span className="text-xl font-black text-emerald-800">{lessonStats.published}</span>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-amber-600 font-bold block mb-1">الدروس المخفية (مسودات)</span>
                        <span className="text-xl font-black text-amber-800">{lessonStats.hidden}</span>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                        <span className="text-xs text-purple-600 font-bold block mb-1">الوحدات الدراسية</span>
                        <span className="text-xl font-black text-purple-800">{lessonStats.unitsCount}</span>
                      </div>
                    </div>

                    {/* قائمة الوحدات والدروس */}
                    <div className="space-y-4">
                      <div className="flex flex-wrap justify-between items-center gap-2 px-1">
                        <span className="text-sm font-black text-gray-700">اضغط على اسم الوحدة لفتح أو طي الدروس:</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setAdminExpandedUnits(data.map(u => u.id))}
                            className="text-xs font-bold px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl transition-all flex items-center gap-1.5 border border-blue-200"
                          >
                            <i className="fas fa-folder-open"></i> فتح الكل
                          </button>
                          <button
                            onClick={() => setAdminExpandedUnits([])}
                            className="text-xs font-bold px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl transition-all flex items-center gap-1.5 border border-gray-300"
                          >
                            <i className="fas fa-folder"></i> طي الكل
                          </button>
                        </div>
                      </div>

                      {data.map(unit => {
                        const unitLessonCount = unit.lessons.length;
                        const unitPublishedCount = unit.lessons.filter(l => isLessonActive(l.id)).length;
                        const isExpanded = adminExpandedUnits.includes(unit.id);

                        return (
                          <div key={unit.id} className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm transition-all">
                            <div 
                              onClick={() => toggleAdminUnit(unit.id)}
                              className="bg-gray-100/70 hover:bg-gray-100 px-4 py-3.5 border-b border-gray-200 flex flex-wrap justify-between items-center gap-2 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2.5">
                                <i className={`fas fa-chevron-${isExpanded ? 'up text-primary' : 'down text-gray-400'} text-sm transition-transform duration-200`}></i>
                                <span className="font-black text-base text-gray-800">{unit.title}</span>
                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full font-bold">
                                  ({unitPublishedCount} من {unitLessonCount} منشور)
                                </span>
                              </div>
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => handleToggleUnitAll(unit.id, true)}
                                  className="text-xs font-bold px-3 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded-lg transition-colors"
                                >
                                  نشر كل الوحدة
                                </button>
                                <button
                                  onClick={() => handleToggleUnitAll(unit.id, false)}
                                  className="text-xs font-bold px-3 py-1 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg transition-colors"
                                >
                                  إخفاء كل الوحدة
                                </button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="p-3 divide-y divide-gray-100 animate-fade-in">
                                {unit.lessons.map(lesson => {
                                  const isPublished = isLessonActive(lesson.id);
                                  return (
                                    <div key={lesson.id} className="py-2.5 px-2 flex items-center justify-between hover:bg-gray-50 rounded-xl transition-colors">
                                      <div className="flex items-center gap-3">
                                        <span className={`w-3 h-3 rounded-full ${isPublished ? 'bg-emerald-500 shadow-sm' : 'bg-gray-300'}`}></span>
                                        <span className={`text-sm font-bold ${isPublished ? 'text-gray-900 font-black' : 'text-gray-400'}`}>
                                          {lesson.title}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-bold">({lesson.questions.length} سؤال)</span>
                                      </div>

                                      <button
                                        onClick={() => handleToggleLesson(lesson.id)}
                                        className={`text-xs font-black px-4 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                                          isPublished
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300'
                                            : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300'
                                        }`}
                                      >
                                        <i className={`fas ${isPublished ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                                        {isPublished ? 'منشور (ظاهر للطالب)' : 'مخفي (مسودة)'}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={handleSavePublishedLessons}
                        disabled={isSavingLessons}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm px-6 py-3 rounded-xl shadow-md active:scale-95 transition-all flex items-center gap-2"
                      >
                        <i className={isSavingLessons ? "fas fa-spinner fa-spin" : "fas fa-cloud-arrow-up"}></i>
                        حفظ ونشر التعديلات للطلاب 🚀
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {adminActiveTab === 'leaderboard' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h2 className="text-xl font-black text-primary flex items-center gap-2">
                        <i className="fas fa-trophy text-gold"></i> أوائل الكنز (لوحة الشرف الذكية)
                      </h2>
                      <p className="text-xs text-gray-500 font-bold mt-1">
                        شرط التأهل: إتمام الدروس المنشورة ({lessonStats.published} دروس) ومعدل ≥ 80% (الذهبية ≥ 90%).
                      </p>
                    </div>
                    <button
                      onClick={() => setAdminActiveTab('lessons')}
                      className="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1.5"
                    >
                      <i className="fas fa-sliders-h"></i> تعديل الدروس المشروطة
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    {(() => {
                      const list = adminLeaderboardList;
                      if (list.length === 0) return <div className="text-center py-6 text-gray-500 font-bold">لا يوجد أبطال مؤهلين في القوائم حالياً.</div>;
                      
                      return list.map((st, idx) => {
                        const prevTier = idx > 0 ? list[idx - 1].tier : '';
                        const showHeader = st.tier !== prevTier;
                        const isGold = st.tier === 'gold';
                        const isSilver = st.tier === 'silver';
                        const isBronze = st.tier === 'bronze';
                        
                        return (
                          <React.Fragment key={idx}>
                            {showHeader && isGold && (
                              <div className="flex flex-col items-center mt-2 mb-2 gap-2">
                                <div className="text-center font-black text-gold text-lg">🏆 القائمة الذهبية (أول ١٠ أبطال) 🏆</div>
                                <button onClick={() => handleAdminCongratulateTier('gold')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            {showHeader && isSilver && (
                              <div className="flex flex-col items-center mt-4 mb-2 gap-2">
                                <div className="text-center font-black text-slate-500 text-lg">🥈 القائمة الفضية (من ١١ إلى ٢٠) 🥈</div>
                                <button onClick={() => handleAdminCongratulateTier('silver')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            {showHeader && isBronze && (
                              <div className="flex flex-col items-center mt-4 mb-2 gap-2">
                                <div className="text-center font-black text-orange-600 text-lg">🥉 القائمة البرونزية (من ٢١ إلى ٣٠) 🥉</div>
                                <button onClick={() => handleAdminCongratulateTier('bronze')} className="bg-emerald-100 text-emerald-800 text-xs font-black py-1.5 px-4 rounded-full border border-emerald-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fab fa-whatsapp"></i> تهنئة القائمة عبر واتساب</button>
                              </div>
                            )}
                            
                            <div className={`flex items-center justify-between p-3 rounded-xl border-2 ${isGold ? 'bg-amber-50 border-gold' : isSilver ? 'bg-slate-50 border-slate-300' : 'bg-orange-50 border-orange-300'}`}>
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="relative shrink-0">
                                  {isGold && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px]"><i className="fas fa-crown text-amber-500 drop-shadow-sm"></i></div>}
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${isGold ? 'bg-gold text-white' : isSilver ? 'bg-slate-400 text-white' : 'bg-orange-600 text-white'}`}>
                                    {idx + 1}
                                  </div>
                                </div>
                                <div className="flex flex-col items-start truncate min-w-0 pr-1">
                                  <span className="font-black text-sm text-gray-800 truncate max-w-[150px] sm:max-w-[200px]" title={st.name}>{st.name}</span>
                                  <span className="text-[10px] font-bold text-gray-500">{toEasternArabic(st.testsCount)} اختبارات | {toEasternArabic(st.score)} نقطة</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="flex flex-col items-center justify-center w-6">
                                  {st.trend === 'up' && <i className="fas fa-arrow-trend-up text-emerald-500 animate-bounce text-lg" title="مستوى صاعد"></i>}
                                  {st.trend === 'down' && <i className="fas fa-arrow-trend-down text-rose-500 animate-pulse text-lg" title="مستوى هابط"></i>}
                                  {st.trend === 'flat' && <i className="fas fa-minus text-gray-400 text-sm" title="مستوى مستقر"></i>}
                                </div>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
              {adminActiveTab === 'certificates' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-4 border-b border-gray-200 flex flex-col gap-3">
                    <h2 className="text-xl font-black text-primary"><i className="fas fa-award text-blue-500 ml-1"></i> متابعة شهادات التقدير</h2>
                    <select 
                      value={adminSelectedUnit} 
                      onChange={(e) => setAdminSelectedUnit(e.target.value)}
                      className="border border-gray-300 rounded-lg p-2 font-bold text-gray-700 outline-none focus:border-primary text-sm"
                    >
                      <option value="">اختر الوحدة للمتابعة...</option>
                      <option value="all">الكل (إحصائية شاملة لكل الوحدات)</option>
                      {data.filter(u => u.lessons.length > 0).map(u => (
                        <option key={u.id} value={u.id}>{u.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="p-4 space-y-3">
                    {(() => {
                      if (!adminSelectedUnit) return <div className="text-center py-6 text-gray-500 font-bold">الرجاء اختيار وحدة لعرض الحاصلين على الشهادة.</div>;
                      
                      const list = calculateAdminCertificates();
                      if (list.length === 0) return <div className="text-center py-6 text-gray-500 font-bold">لا توجد درجات مسجلة للطلاب في هذا الاختيار حتى الآن.</div>;
                      
                      return list.map((st, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl border border-blue-200 bg-blue-50">
                          <div className="flex items-center gap-3 min-w-0 pr-1">
                            <i className="fas fa-award text-2xl text-gold shrink-0"></i>
                            <div className="flex flex-col items-start truncate min-w-0">
                              <span className="font-black text-sm text-gray-800 truncate max-w-[120px] sm:max-w-[200px]" title={st.name}>{st.name}</span>
                              <span className="text-[10px] font-bold text-blue-600">متوسط: %{toEasternArabic(st.avg)} | {st.unitTitle} {st.totalScore ? `(${toEasternArabic(st.totalScore)} نقطة)` : ''}</span>
                            </div>
                          </div>
                          <button onClick={() => handleDownloadAdminCert(st.name, st.unitTitle, st.avg)} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-black shadow-sm transition-colors active:scale-95 shrink-0 flex items-center gap-1">
                            <i className="fas fa-download"></i> شهادة
                          </button>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
              {adminActiveTab === 'requests' && (
                <div className="space-y-6">
                  {/* شريط العنوان والإجراء السريع */}
                  <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-5 rounded-2xl shadow-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-emerald-400/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-bold border border-emerald-400/30">
                          نظام الأونلاين الآمن
                        </span>
                        <span className="text-xs text-emerald-200">سجل المشتركين وتوليد الأكواد</span>
                      </div>
                      <h2 className="text-xl font-black flex items-center gap-2">
                        <i className="fas fa-users-cog text-emerald-300"></i> إدارة طلبات ومشتركي الأونلاين
                      </h2>
                      <p className="text-xs text-emerald-100 mt-1">توليد كود الطالب التلقائي بصيغة (A5678ESON) وتفعيل الباقات وإرسال بيانات الدخول عبر واتساب.</p>
                    </div>
                    <button
                      onClick={() => setShowManualOnlineModal(true)}
                      className="bg-white text-emerald-900 hover:bg-emerald-50 font-black px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 shrink-0 active:scale-95 text-sm cursor-pointer"
                    >
                      <i className="fas fa-user-plus text-emerald-600"></i> إضافة طالب أونلاين يدوياً
                    </button>
                  </div>

                  {/* القسم الأول: طلبات الاشتراك المعلقة */}
                  <div className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100">
                    <div className="bg-amber-50/70 px-6 py-4 border-b border-amber-200/60 flex justify-between items-center">
                      <h3 className="text-lg font-black text-amber-950 flex items-center gap-2">
                        <i className="fas fa-clock text-amber-600"></i> طلبات الاشتراك المعلقة
                        <span className="bg-amber-200 text-amber-900 text-xs px-2.5 py-0.5 rounded-full font-bold">
                          {adminPendingReqs.length} طلب
                        </span>
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-right">
                        <thead className="bg-gray-50 text-gray-600 text-xs sm:text-sm">
                          <tr>
                            <th className="p-4">التاريخ</th>
                            <th className="p-4">اسم الطالب</th>
                            <th className="p-4">رقم الهاتف</th>
                            <th className="p-4">طريقة التحويل</th>
                            <th className="p-4 text-center">الإجراء</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {adminPendingReqs.map((req, i) => (
                            <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                              <td className="p-4 text-xs sm:text-sm text-gray-500">{req.date}</td>
                              <td className="p-4 font-black text-gray-800">{req.name}</td>
                              <td className="p-4 font-bold text-gray-700" dir="ltr">{req.phone}</td>
                              <td className="p-4 text-sm font-bold">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black ${req.method.includes('كاش') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
                                  {req.method}
                                </span>
                              </td>
                              <td className="p-4 text-center">
                                <div className="flex gap-2 justify-center">
                                  <button
                                    onClick={() => handleOpenActivationModal(req)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-black shadow-sm transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <i className="fas fa-check-circle"></i> تفعيل وباقة
                                  </button>
                                  <button
                                    onClick={() => handleRejectSubscription(req.phone, req.name)}
                                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                  >
                                    <i className="fas fa-trash-alt"></i> رفض
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {adminPendingReqs.length === 0 && (
                            <tr>
                              <td colSpan={5} className="text-center p-8 text-gray-400 font-bold">
                                <i className="fas fa-check-double text-3xl text-emerald-400 mb-1 block"></i>
                                لا توجد أي طلبات معلقة حالياً.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* القسم الثاني: جدول المشتركين الأونلاين المعتمدين */}
                  <div className="bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100">
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div>
                        <h3 className="text-lg font-black text-emerald-950 flex items-center gap-2">
                          <i className="fas fa-id-card text-emerald-600"></i> المشتركون الأونلاين المعتمدون
                          <span className="bg-emerald-200 text-emerald-900 text-xs px-2.5 py-0.5 rounded-full font-bold">
                            {adminOnlineStudents.length} مشترك
                          </span>
                        </h3>
                        <p className="text-xs text-emerald-700 mt-0.5">سجل دائم ومستقل لطلاب الأونلاين مفصول عن طلاب السنتر لمنع أي تداخل.</p>
                      </div>
                      
                      {/* مربع البحث في الأونلاين */}
                      <div className="w-full sm:w-64 relative">
                        <input
                          type="text"
                          placeholder="بحث بالاسم أو الهاتف أو الكود..."
                          value={onlineSearchTerm}
                          onChange={(e) => setOnlineSearchTerm(e.target.value)}
                          className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 pr-8"
                        />
                        <i className="fas fa-search absolute right-2.5 top-2.5 text-emerald-600 text-xs"></i>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-right">
                        <thead className="bg-gray-100 text-gray-600 text-xs sm:text-sm">
                          <tr>
                            <th className="p-4">كود الدخول</th>
                            <th className="p-4">اسم الطالب</th>
                            <th className="p-4">رقم الهاتف</th>
                            <th className="p-4">نوع الباقة</th>
                            <th className="p-4">حالة الاشتراك</th>
                            <th className="p-4">الشهور المفعلة</th>
                            <th className="p-4 text-center">إجراءات المتابعة والواتساب</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                          {(() => {
                            const filtered = adminOnlineStudents.filter(st => {
                              if (!onlineSearchTerm.trim()) return true;
                              const term = onlineSearchTerm.trim().toLowerCase();
                              return (st.name && st.name.toLowerCase().includes(term)) ||
                                     (st.phone && st.phone.includes(term)) ||
                                     (st.code && st.code.toLowerCase().includes(term));
                            });

                            if (filtered.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={7} className="text-center p-10 text-gray-400 font-bold">
                                    <i className="fas fa-user-friends text-3xl text-gray-300 mb-2 block"></i>
                                    {adminOnlineStudents.length === 0 ? 'لم يتم تفعيل أي طالب أونلاين بعد.' : 'لا توجد نتائج مطابقة لبحثك.'}
                                  </td>
                                </tr>
                              );
                            }

                            return filtered.map((st, idx) => (
                              <tr key={idx} className="hover:bg-emerald-50/30 transition-colors">
                                <td className="p-4">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg" dir="ltr">
                                      {st.code}
                                    </span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(st.code);
                                        setCopiedCodePhone(st.phone);
                                        setTimeout(() => setCopiedCodePhone(''), 2000);
                                      }}
                                      title="نسخ الكود"
                                      className="text-gray-400 hover:text-emerald-600 text-xs p-1"
                                    >
                                      {copiedCodePhone === st.phone ? <i className="fas fa-check text-emerald-600"></i> : <i className="far fa-copy"></i>}
                                    </button>
                                  </div>
                                </td>
                                <td className="p-4 font-black text-gray-900">{st.name}</td>
                                <td className="p-4 font-bold text-gray-700" dir="ltr">{st.phone}</td>
                                {(() => {
                                  const subStatus = getOnlineSubscriptionStatus(st);
                                  return (
                                    <>
                                      <td className="p-4 font-bold">
                                        <span className="inline-block bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-md text-xs">
                                          {st.packageType || 'شهري'}
                                        </span>
                                      </td>
                                      <td className="p-4">
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black border ${subStatus.color}`}>
                                          {subStatus.label}
                                        </span>
                                      </td>
                                      <td className="p-4 text-xs font-bold text-gray-600 max-w-[150px] truncate" title={st.activeMonths}>
                                        {st.activeMonths || '—'}
                                      </td>
                                      <td className="p-4 text-center">
                                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                          {/* زر إرسال كود وبيانات الدخول */}
                                          <button
                                            onClick={() => sendWhatsAppStudentWelcome(st.phone, st.name, st.code, st.packageType || 'الاشتراك')}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg text-xs font-black shadow-sm transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                            title="إرسال رسالة الترحيب وكود الدخول"
                                          >
                                            <i className="fab fa-whatsapp"></i> الكود
                                          </button>

                                          {/* زر إرسال تذكرة التجديد */}
                                          <button
                                            onClick={() => sendWhatsAppRenewalReminder(st.phone, st.name, st.packageType || 'الاشتراك')}
                                            className="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg text-xs font-black shadow-sm transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                            title="إرسال رسالة تذكير بتجديد الاشتراك"
                                          >
                                            <i className="fas fa-bell"></i> تذكير
                                          </button>

                                          {/* زر إلغاء الاشتراك ونقله للأرشيف */}
                                          <button
                                            onClick={() => handleCancelOnlineSubscription(st)}
                                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                                            title="إلغاء الاشتراك ونقل الطالب للأرشيف"
                                          >
                                            <i className="fas fa-trash-alt"></i>
                                          </button>
                                        </div>
                                      </td>
                                    </>
                                  );
                                })()}
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* مودال تفعيل الطالب واختيار نوع الباقة */}
                  {selectedActivationReq && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-xl font-black text-emerald-800 flex items-center gap-2">
                            <i className="fas fa-user-check text-emerald-600"></i> تفعيل اشتراك أونلاين
                          </h3>
                          <button onClick={() => setSelectedActivationReq(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-1.5 text-sm">
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">الطالب:</span><span className="font-black text-gray-900">{selectedActivationReq.name}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">رقم الهاتف:</span><span className="font-bold text-gray-900" dir="ltr">{selectedActivationReq.phone}</span></div>
                          <div className="flex justify-between"><span className="text-gray-600 font-bold">طريقة الدفع:</span><span className="font-bold text-emerald-700">{selectedActivationReq.method}</span></div>
                          <div className="flex justify-between pt-2 border-t border-emerald-200">
                            <span className="text-emerald-900 font-black">الكود المقترح التلقائي:</span>
                            <span className="font-mono font-black text-base text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300" dir="ltr">
                              {generateOnlineCodeClient(selectedActivationReq.name, selectedActivationReq.phone)}
                            </span>
                          </div>
                        </div>

                        {/* اختيار نوع الباقة */}
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-2">نوع باقة الاشتراك:</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'شهري', title: 'اشتراك شهري', desc: 'شهر محدد', color: 'border-blue-400 bg-blue-50 text-blue-900' },
                              { id: 'ترم أول', title: 'اشتراك الترم الأول', desc: 'أغسطس - يناير', color: 'border-indigo-400 bg-indigo-50 text-indigo-900' },
                              { id: 'ترم ثانٍ', title: 'اشتراك الترم الثاني', desc: 'فبراير - مايو', color: 'border-purple-400 bg-purple-50 text-purple-900' },
                              { id: 'سنة كاملة', title: 'اشتراك سنوي كامل', desc: 'العام كاملاً', color: 'border-amber-400 bg-amber-50 text-amber-900' }
                            ].map(pkg => (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => {
                                  setActivationPackage(pkg.id as any);
                                  if (pkg.id === 'سنة كاملة') setActivationAmount('400');
                                  else if (pkg.id.includes('ترم')) setActivationAmount('200');
                                  else setActivationAmount('50');
                                }}
                                className={`p-2.5 rounded-xl border-2 text-right transition-all cursor-pointer ${activationPackage === pkg.id ? pkg.color + ' ring-2 ring-emerald-500 font-black shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 font-bold'}`}
                              >
                                <div className="text-xs font-black">{pkg.title}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5">{pkg.desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* اختيار الشهر في حالة الاشتراك الشهري */}
                        {activationPackage === 'شهري' && (
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1">الشهر المراد تفعيله:</label>
                            <select
                              value={activationMonth}
                              onChange={(e) => setActivationMonth(e.target.value)}
                              className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold bg-white text-gray-800 outline-none focus:border-emerald-600"
                            >
                              {["أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleConfirmActivation}
                            disabled={isActivatingOnline}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                          >
                            {isActivatingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-check"></i> تأكيد التفعيل وتوليد الكود</>}
                          </button>
                          <button
                            onClick={() => setSelectedActivationReq(null)}
                            disabled={isActivatingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* مودال الإضافة اليدوية لطالب أونلاين */}
                  {showManualOnlineModal && (
                    <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
                      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-right">
                        <div className="flex justify-between items-center border-b pb-3">
                          <h3 className="text-xl font-black text-emerald-800 flex items-center gap-2">
                            <i className="fas fa-user-plus text-emerald-600"></i> إضافة مشترك أونلاين يدوياً
                          </h3>
                          <button onClick={() => setShowManualOnlineModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">اسم الطالب رباعي:</label>
                          <input
                            type="text"
                            placeholder="مثال: أحمد مصطفى محمود"
                            value={manualOnlineName}
                            onChange={(e) => setManualOnlineName(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">رقم الهاتف (واتساب):</label>
                          <input
                            type="tel"
                            placeholder="مثال: 01012345678"
                            value={manualOnlinePhone}
                            onChange={(e) => setManualOnlinePhone(e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-emerald-600 text-gray-800 text-right"
                            dir="ltr"
                          />
                        </div>

                        {manualOnlineName && manualOnlinePhone && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex justify-between items-center text-xs">
                            <span className="font-bold text-emerald-900">الكود الذي سيتم توليده:</span>
                            <span className="font-mono font-black text-sm text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-300">
                              {generateOnlineCodeClient(manualOnlineName, manualOnlinePhone)}
                            </span>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-2">نوع الباقة:</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'شهري', title: 'اشتراك شهري' },
                              { id: 'ترم أول', title: 'الترم الأول كامل' },
                              { id: 'ترم ثانٍ', title: 'الترم الثاني كامل' },
                              { id: 'سنة كاملة', title: 'السنة كاملة' }
                            ].map(pkg => (
                              <button
                                key={pkg.id}
                                type="button"
                                onClick={() => setActivationPackage(pkg.id as any)}
                                className={`p-2 rounded-xl border-2 text-center text-xs font-black transition-all cursor-pointer ${activationPackage === pkg.id ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-400' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                              >
                                {pkg.title}
                              </button>
                            ))}
                          </div>
                        </div>

                        {activationPackage === 'شهري' && (
                          <div>
                            <label className="block text-xs font-black text-gray-700 mb-1">الشهر:</label>
                            <select
                              value={activationMonth}
                              onChange={(e) => setActivationMonth(e.target.value)}
                              className="w-full border-2 border-gray-300 rounded-xl p-2 text-sm font-bold bg-white text-gray-800 outline-none focus:border-emerald-600"
                            >
                              {["أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر", "يناير", "فبراير", "مارس", "أبريل", "مايو"].map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={handleManualAddOnline}
                            disabled={isActivatingOnline}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                          >
                            {isActivatingOnline ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-plus"></i> إضافة وتفعيل فوري</>}
                          </button>
                          <button
                            onClick={() => setShowManualOnlineModal(false)}
                            disabled={isActivatingOnline}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition-all cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* مودال نجاح التفعيل وزر إرسال رسالة الترحيب عبر واتساب */}
                  {activationSuccess && (
                    <div className="fixed inset-0 bg-black/70 z-[130] flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
                      <div className="bg-white rounded-3xl max-w-sm w-full p-6 sm:p-7 shadow-2xl text-center border-2 border-emerald-300 relative">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
                          <i className="fas fa-check"></i>
                        </div>
                        <h3 className="text-xl font-black text-emerald-950 mb-1">تم تفعيل الاشتراك بنجاح! 🎉</h3>
                        <p className="text-xs text-gray-600 font-bold mb-4">تم حفظ الطالب في شيت طلاب الأونلاين وشيت الطلاب وتفعيل الشهور.</p>

                        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-right space-y-2 mb-5">
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الطالب:</span><span className="font-black text-gray-800">{activationSuccess.name}</span></div>
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الهاتف:</span><span className="font-bold text-gray-800" dir="ltr">{activationSuccess.phone}</span></div>
                          <div className="flex justify-between text-xs"><span className="text-gray-500 font-bold">الباقة:</span><span className="font-bold text-emerald-700">{activationSuccess.packageType}</span></div>
                          <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                            <span className="text-xs font-black text-gray-700">كود الدخول:</span>
                            <span className="font-mono font-black text-lg text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-300" dir="ltr">
                              {activationSuccess.code}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          {/* زر واتساب المباشر الموثوق 100% */}
                          <button
                            onClick={() => sendWhatsAppStudentWelcome(activationSuccess.phone, activationSuccess.name, activationSuccess.code, activationSuccess.packageType)}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-sm"
                          >
                            <i className="fab fa-whatsapp text-lg"></i> إرسال رسالة الترحيب والكود للطالب
                          </button>
                          
                          <button
                            onClick={() => {
                              const appLink = window.location.href.split('?')[0];
                              const msg = `أهلاً بك يا بطل في موسوعة الكنز التعليمي 🎓\nيسعدنا انضمامك معنا في منصة التاريخ (2 بكالوريا) للأستاذ / إسلام سعود ✨\n\nتم تفعيل اشتراكك بنجاح (${activationSuccess.packageType})، وبيانات دخولك هي:\n📱 رقم الهاتف المسجل: ${activationSuccess.phone}\n🔑 كود الطالب: ${activationSuccess.code}\n🌐 رابط المنصة: ${appLink}\n\nنتمنى لك رحلة تفوق مميزة والدرجة النهائية بإذن الله! 🌟`;
                              navigator.clipboard.writeText(msg);
                              showAlert('تم نسخ الرسالة وبيانات الدخول إلى الحافظة بنجاح!');
                            }}
                            className="w-full bg-gray-50 hover:bg-gray-100 text-emerald-800 border border-emerald-200 font-bold py-2 rounded-xl transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <i className="far fa-copy text-xs"></i> نسخ نص الرسالة والكود
                          </button>

                          <button
                            onClick={() => setActivationSuccess(null)}
                            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl transition-all text-xs cursor-pointer"
                          >
                            إغلاق
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {adminActiveTab === 'search' && (
                <div className="space-y-6">
                  {/* بطاقة المزامنة الذكية مع تطبيق السنتر والدرس */}
                  <div className="bg-gradient-to-br from-indigo-950 via-primary to-slate-900 text-white rounded-2xl shadow-xl p-5 sm:p-6 border border-white/10">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4 mb-5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                            <i className="fas fa-magic text-[10px]"></i> مزامنة آلية ذكية
                          </span>
                          <span className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                            المرحلة: 2 ثانوي / 2 بكالوريا
                          </span>
                        </div>
                        <h2 className="text-lg sm:text-xl font-black flex items-center gap-2">
                          <i className="fab fa-google-drive text-amber-400 text-xl"></i> مزامنة اشتراكات تطبيق الدرس والسنتر
                        </h2>
                        <p className="text-blue-200 text-xs sm:text-sm mt-1">تحديث شهور وسداد الطلاب تلقائياً برقم الهاتف من مجلد النسخ الاحتياطية (System_Backups).</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* الخيار الأول: سحابياً من Google Drive */}
                      <div className="bg-white/5 hover:bg-white/10 transition-all backdrop-blur-sm border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm text-amber-300 flex items-center gap-1.5 mb-1">
                            <i className="fas fa-cloud-download-alt"></i> 1. المزامنة السحابية (Google Drive)
                          </div>
                          <p className="text-xs text-blue-100/80 leading-relaxed">
                            قراءة أحدث ملف باك آب تم رفعه اليوم تلقائياً إلى مجلد <span className="font-mono bg-black/30 px-1 py-0.5 rounded text-amber-200" dir="ltr">System_Backups</span> ومطابقة الشهور المدفوعة.
                          </p>
                        </div>
                        <button
                          onClick={handleSyncDriveBackups}
                          disabled={isSyncingDrive || isSyncingLocal}
                          className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black py-2.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                        >
                          {isSyncingDrive ? (
                            <>
                              <i className="fas fa-spinner fa-spin"></i> جاري قراءة الدرايف وتحديث الشيت...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-sync-alt"></i> مزامنة الآن من Google Drive
                            </>
                          )}
                        </button>
                      </div>

                      {/* الخيار الثاني: رفع ملف الباك آب محلياً */}
                      <div className="bg-white/5 hover:bg-white/10 transition-all backdrop-blur-sm border border-white/10 rounded-xl p-4 flex flex-col justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm text-cyan-300 flex items-center gap-1.5 mb-1">
                            <i className="fas fa-file-code"></i> 2. الرفع المباشر (ملف JSON محلي)
                          </div>
                          <p className="text-xs text-blue-100/80 leading-relaxed">
                            اختيار ملف <span className="font-mono bg-black/30 px-1 py-0.5 rounded text-cyan-200" dir="ltr">emergency_autosave.json</span> أو أي ملف باك آب من جهازك فوراً كخطة بديلة.
                          </p>
                        </div>
                        <label className={`w-full bg-white/15 hover:bg-white/25 text-white font-black py-2.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 text-sm cursor-pointer border border-white/20 ${(isSyncingDrive || isSyncingLocal) ? 'opacity-50 pointer-events-none' : ''}`}>
                          <input
                            type="file"
                            accept=".json"
                            onChange={handleSyncLocalBackupFile}
                            className="hidden"
                            disabled={isSyncingDrive || isSyncingLocal}
                          />
                          {isSyncingLocal ? (
                            <>
                              <i className="fas fa-spinner fa-spin"></i> جاري معالجة الملف والتحديث...
                            </>
                          ) : (
                            <>
                              <i className="fas fa-upload"></i> رفع ملف الباك آب (JSON)
                            </>
                          )}
                        </label>
                      </div>
                    </div>
                  </div>
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4"><h2 className="text-xl font-black text-primary"><i className="fas fa-search-dollar text-green-600 ml-1"></i> تفعيل المتأخرات</h2><input type="text" placeholder="بحث بالاسم أو الرقم..." className="border-2 rounded-xl px-4 py-2 w-full sm:w-64 focus:border-primary outline-none text-sm font-bold" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} /></div>
                  <div className="p-6 space-y-3">
                    {(() => {
                      const list: React.ReactNode[] = [];
                      Object.entries(studentsList).forEach(([phone, arr]) => {
                        const students = Array.isArray(arr) ? arr : [arr];
                        students.forEach((st, i) => {
                          if (searchQuery) {
                            const sq = searchQuery.toLowerCase();
                            const n = st.name ? String(st.name).toLowerCase() : '';
                            const p = phone ? String(phone) : '';
                            if (!n.includes(sq) && !p.includes(sq)) return;
                          }
                          if (st.isPaid || !st.missingMonths || st.missingMonths.length === 0) return;
                          
                          list.push(
                            <div key={`${phone}-${i}`} className="bg-red-50 border border-red-100 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-center gap-4">
                              <div className="flex items-center gap-3 w-full sm:w-auto">
                                <div className="font-black text-base sm:text-lg text-red-800 truncate max-w-[150px] sm:max-w-[200px]" title={st.name}>{st.name}</div>
                                <div className="font-bold text-xs sm:text-sm text-red-500 bg-red-100/50 px-2 py-1 rounded-md" dir="ltr">{phone}</div>
                              </div>
                              <div className="flex flex-wrap gap-2 justify-center shrink-0">
                                {st.missingMonths.map((m, mIdx) => (
                                  <button 
                                    key={mIdx} 
                                    onClick={() => handleActivateMonth(phone, st.name, m)} 
                                    className="bg-white border-2 border-red-500 text-red-600 font-bold px-3 py-1.5 rounded-lg text-sm hover:bg-red-500 hover:text-white transition-colors flex items-center gap-1"
                                  >
                                    <i className="fas fa-check-circle"></i> تفعيل {m}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        });
                      });
                      return list.length > 0 ? list : <div className="text-center text-gray-500 font-bold py-6">لا توجد اشتراكات متأخرة مطابقة.</div>;
                    })()}
                  </div>
                </div>
                </div>
              )}
              {adminActiveTab === 'settings' && (
                <div className="bg-white rounded-2xl shadow-md overflow-hidden max-w-lg">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200"><h2 className="text-xl font-black text-primary"><i className="fas fa-cog text-gray-500 ml-1"></i> إعدادات المنصة</h2></div>
                  <div className="p-6">
                    <div className="mb-4">
                      <label className="block text-gray-700 font-bold mb-2">قيمة الاشتراك الحالية:</label>
                      <div className="bg-gray-100 px-4 py-3 rounded-xl font-black text-secondary text-lg border">{platformFee}</div>
                    </div>
                    <div className="mb-6">
                      <label className="block text-gray-700 font-bold mb-2">تحديث السعر:</label>
                      <input type="text" placeholder="مثال: 60 جنيهاً" className="w-full border-2 focus:border-secondary outline-none rounded-xl px-4 py-3 text-lg font-bold" value={newFeeInput} onChange={e=>setNewFeeInput(e.target.value)} />
                    </div>
                    
                    <div className="mb-6">
                      <label className="block text-gray-700 font-bold mb-2">الإشعار الحالي للطلاب 📢:</label>
                      <textarea 
                        placeholder="اكتب التنبيه هنا ليظهر لجميع الطلاب فوراً في أعلى الفهرس..." 
                        className="w-full border-2 focus:border-secondary outline-none rounded-xl px-4 py-3 text-base font-bold h-28 resize-none text-right" 
                        value={announcementInput} 
                        onChange={e=>setAnnouncementInput(e.target.value)} 
                      />
                      <p className="text-xs text-gray-500 mt-1 font-bold">امسح نص الإشعار بالكامل واضغط حفظ الإعدادات لإخفاء الإشعار من واجهة الطلاب.</p>

                      {announcementInput && announcementInput.trim() !== "" && (
                        <div className="mt-4 animate-fade-in">
                          <label className="block text-gray-700 font-bold mb-2">معاينة حية للإشعار:</label>
                          <div className="bg-orange-50 border-r-4 border-gold p-4 rounded-2xl shadow-sm flex items-start gap-3 relative" style={{ fontSize: '11px', lineHeight: '21px', paddingLeft: '14px', paddingTop: '9px' }}>
                            <button className="absolute top-2 left-2 text-gray-400 hover:text-red-500 transition-colors p-1 cursor-default" title="زر إخفاء الإشعار (للعرض فقط)" type="button">
                              <i className="fas fa-times"></i>
                            </button>
                            <span className="text-gold text-xl shrink-0"><i className="fas fa-bullhorn animate-bounce"></i></span>
                            <div className="flex-1 text-right">
                              <h4 className="font-black text-gold text-xs sm:text-sm mb-0.5">تنبيه هام من الأستاذ 📢:</h4>
                              <p className="text-gray-800 text-sm sm:text-base font-bold leading-relaxed whitespace-pre-line" style={{ fontSize: '13px', textAlign: 'justify', lineHeight: '19.5px' }}>{announcementInput}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="mb-6 pt-6 border-t border-gray-200">
                      <h3 className="text-lg font-black text-gray-800 mb-4"><i className="fas fa-clock text-blue-500 ml-1"></i> إعدادات العداد الزمني للاختبارات</h3>
                      
                      <div className="mb-4">
                        <label className="block text-gray-700 font-bold mb-2">تفعيل العداد على:</label>
                        <select 
                          value={timerMode} 
                          onChange={(e) => setTimerMode(e.target.value)}
                          className="w-full border-2 border-gray-300 rounded-xl p-3 font-bold text-gray-700 outline-none focus:border-secondary"
                        >
                          <option value="custom_units">تحديد وحدات معينة</option>
                          <option value="custom_lessons">تحديد دروس/اختبارات معينة</option>
                          <option value="all">جميع الدروس والامتحانات</option>
                          <option value="disabled">معطل (بدون وقت)</option>
                        </select>
                      </div>

                      {(timerMode === 'custom_units' || timerMode === 'unit') && (
                        <div className="mb-4 animate-fade-in">
                          <label className="block text-gray-700 font-bold mb-2">اختر الوحدات المستهدفة:</label>
                          <div className="flex flex-col gap-2">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <label key={u.id} className="flex items-center gap-3 cursor-pointer p-3 border-2 rounded-xl hover:bg-gray-50 transition-colors">
                                <input 
                                  type="checkbox" 
                                  checked={timerUnitTargets.includes(u.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setTimerUnitTargets(prev => [...prev, u.id]);
                                    } else {
                                      setTimerUnitTargets(prev => prev.filter(id => id !== u.id));
                                    }
                                  }}
                                  className="w-5 h-5 accent-secondary"
                                />
                                <span className="font-bold text-gray-800">{u.title}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {timerMode === 'custom_lessons' && (
                        <div className="mb-4 animate-fade-in">
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-gray-700 font-bold">اختر الاختبارات المستهدفة:</label>
                            <button 
                              onClick={() => {
                                const allLessonIds = data.flatMap(u => u.lessons.map(l => l.id));
                                if (timerUnitTargets.length === allLessonIds.length) {
                                  setTimerUnitTargets([]);
                                } else {
                                  setTimerUnitTargets(allLessonIds);
                                }
                              }}
                              className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg font-bold transition-colors"
                            >
                              {timerUnitTargets.length > 0 && timerUnitTargets.length === data.flatMap(u => u.lessons.map(l => l.id)).length ? 'إلغاء التحديد' : 'تحديد الكل'}
                            </button>
                          </div>
                          <div className="flex flex-col gap-4 max-h-64 overflow-y-auto custom-scrollbar p-2 border-2 border-gray-200 rounded-xl bg-gray-50">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                <div className="font-black text-primary mb-2 border-b pb-2">{u.title}</div>
                                <div className="flex flex-col gap-2 pl-4">
                                  {u.lessons.map(l => (
                                    <label key={l.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={timerUnitTargets.includes(l.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setTimerUnitTargets(prev => [...prev, l.id]);
                                          } else {
                                            setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                          }
                                        }}
                                        className="w-4 h-4 accent-secondary"
                                      />
                                      <span className="font-bold text-gray-700 text-sm">{l.title}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mb-6">
                        <label className="block text-gray-700 font-bold mb-2">الوقت المخصص لكل سؤال (بالثواني):</label>
                        <input 
                          type="number" 
                          className="w-full border-2 focus:border-secondary outline-none rounded-xl px-4 py-3 text-lg font-bold" 
                          value={timerSecondsPerQ} 
                          onChange={e=>setTimerSecondsPerQ(Number(e.target.value))}
                          min="5" max="600"
                        />
                      </div>
                    </div>

                    <button onClick={handleUpdateFee} className="w-full text-white font-bold py-3 rounded-xl shadow transition-colors bg-primary hover:bg-blue-800">حفظ الإعدادات</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {showAdminScrollTop && (
            <button
              onClick={() => adminScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="fixed bottom-6 left-6 md:bottom-8 md:left-8 bg-primary hover:bg-blue-800 text-white w-12 h-12 rounded-full shadow-2xl border-2 border-blue-400 flex items-center justify-center transition-all hover:-translate-y-1 active:scale-95 z-[999] cursor-pointer animate-fade-in"
              title="العودة للأعلى"
            >
              <i className="fas fa-arrow-up text-xl"></i>
            </button>
          )}
        </div>
      );
    }
    return null;
  };
  
  return (
    <React.Fragment>
      {renderScreen()}
      
      {lessonModalOptions && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl text-center animate-fade-in flex flex-col relative max-h-[90dvh] overflow-y-auto custom-scrollbar">
            <div className="absolute top-0 right-0 w-full h-2 bg-secondary"></div>
            
            <h2 className="text-xl md:text-2xl font-black text-primary mb-6 mt-2">{formatLessonTitleJSX(lessonModalOptions.title)}</h2>
            
            {lessonModalOptions.video && (
              <div className="mb-4 w-full rounded-2xl overflow-hidden shadow-sm border border-gray-200 relative flex items-center justify-center" style={lessonModalOptions.video.startsWith('http') ? { paddingTop: '56.25%', backgroundColor: 'black' } : { minHeight: '120px', backgroundColor: '#f3f4f6' }}>
                {lessonModalOptions.video.startsWith('http') ? (
                  <iframe 
                    className="absolute top-0 left-0 w-full h-full"
                    src={getYoutubeEmbedLink(lessonModalOptions.video)} 
                    title="YouTube video" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen>
                  </iframe>
                ) : (
                  <div className="flex flex-col items-center justify-center p-4">
                    <i className="fas fa-video-slash text-4xl text-gray-400 mb-2"></i>
                    <span className="font-black text-rose-600 text-lg">{lessonModalOptions.video}</span>
                  </div>
                )}
              </div>
            )}
            
            {lessonModalOptions.audio && (
              <div className="bg-blue-50 border-2 border-blue-100 dark:bg-gray-800/10 dark:border-gray-800 rounded-2xl p-4 mb-4" dir="rtl">
                <p className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-3 flex items-center justify-center gap-2">
                  <i className="fas fa-headphones-alt text-xl"></i> الاستماع للشرح:
                </p>
                {lessonModalOptions.audio.startsWith('http') ? (
                  <div className="text-center space-y-2">
                    {globalAudio && globalAudio.url === lessonModalOptions.audio ? (
                      <div className="space-y-3 bg-white dark:bg-gray-900 border border-blue-100 dark:border-gray-800 rounded-xl p-3 shadow-sm">
                        <div className="flex items-center justify-center gap-3">
                          <button 
                            onClick={toggleGlobalAudio} 
                            className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center text-lg transition-transform active:scale-95 shadow-md cursor-pointer"
                            title={isGlobalAudioPlaying ? "إيقاف مؤقت" : "تشغيل"}
                            disabled={isAudioLoading}
                          >
                            {isAudioLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className={`fas ${isGlobalAudioPlaying ? 'fa-pause' : 'fa-play ml-1'}`}></i>}
                          </button>
                          
                          <div className="text-right flex-1 min-w-0">
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-bold">يتم تشغيل الشرح الصوتي 🎧</p>
                          </div>
                        </div>

                        {/* Progress slider synced globally */}
                        <div className="space-y-1">
                          <input 
                            type="range" 
                            min={0} 
                            max={globalAudioDuration || 100} 
                            value={globalAudioTime} 
                            onChange={handleGlobalAudioSeek} 
                            className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                          <div className="flex justify-between text-[10px] text-gray-500 font-bold" dir="ltr">
                            <span>{formatAudioTime(globalAudioTime)}</span>
                            <span>{formatAudioTime(globalAudioDuration)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => playLessonAudio(lessonModalOptions.audio!, lessonModalOptions.title)}
                        className={`w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2.5 cursor-pointer text-base ${isAudioLoading ? 'opacity-80 cursor-wait' : ''}`}
                        disabled={isAudioLoading}
                      >
                        {isAudioLoading ? <i className="fas fa-spinner fa-spin text-xl"></i> : <i className="fas fa-play-circle text-xl animate-pulse"></i>}
                        {isAudioLoading ? 'جاري التحميل...' : 'تشغيل الشرح الصوتي والاستماع في الخلفية'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white border border-blue-200 rounded-xl py-3 px-4 text-center shadow-sm">
                    <span className="font-black text-rose-600 text-lg">{lessonModalOptions.audio}</span>
                  </div>
                )}
              </div>
            )}
            
            <div className="flex flex-col gap-3 mt-2 mt-auto">
              <button onClick={() => startQuizForLesson(lessonModalOptions)} className="w-full bg-primary text-white font-black text-lg py-3 rounded-xl shadow-md hover:bg-gray-900 transition-colors flex justify-center items-center gap-2">
                <i className="fas fa-pen-alt"></i> الدخول للتدريبات
              </button>
              <button onClick={() => setLessonModalOptions(null)} className="w-full bg-gray-100 text-gray-600 font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors">
                إغلاق وعودة
              </button>
            </div>
          </div>
        </div>
      )}
      
      {dialog.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[999] flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl text-center animate-fade-in">
            <i className={`fas ${dialog.type === 'confirm' ? 'fa-question-circle text-primary' : 'fa-info-circle text-secondary'} text-5xl mb-4 block`}></i>
            <h2 className="text-xl font-black text-gray-800 mb-6 whitespace-pre-line leading-relaxed">{dialog.message}</h2>
            <div className="flex gap-3">
              {dialog.type === 'confirm' ? (
                <React.Fragment>
                  <button onClick={() => { if(dialog.onConfirm) dialog.onConfirm(); closeDialog(); }} className="flex-1 bg-secondary text-white font-black text-lg py-3 rounded-xl hover:bg-green-700 transition-colors">تأكيد</button>
                  <button onClick={closeDialog} className="flex-1 bg-gray-200 text-gray-800 font-black text-lg py-3 rounded-xl hover:bg-gray-300 transition-colors">إلغاء</button>
                </React.Fragment>
              ) : (
                <button onClick={closeDialog} className="w-full bg-primary text-white font-black text-lg py-3 rounded-xl hover:bg-gray-900 transition-colors">حسناً</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showIOSInstallGuide && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative text-center">
            <button 
              onClick={() => setShowIOSInstallGuide(false)} 
              className="absolute top-4 left-4 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            <i className="fas fa-download text-5xl text-emerald-600 mb-3 block animate-bounce"></i>
            <h2 className="text-xl sm:text-2xl font-black text-primary mb-3">دليلك لتثبيت التطبيق 📱💻</h2>
            
            {/* Tabs Selector */}
            <div className="bg-gray-100 p-1.5 rounded-2xl flex gap-1 w-full mb-6">
              <button 
                onClick={() => setInstallTab('android')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'android' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                أندرويد 🤖
              </button>
              <button 
                onClick={() => setInstallTab('ios')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'ios' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                آيفون / آيباد 🍎
              </button>
              <button 
                onClick={() => setInstallTab('pc')}
                className={`flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${installTab === 'pc' ? 'bg-white text-emerald-700 shadow-md scale-102' : 'text-gray-600 hover:text-gray-800'}`}
              >
                الكمبيوتر 💻
              </button>
            </div>

            {/* TAB: Android */}
            {installTab === 'android' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  لتثبيت التطبيق مباشرة (مثل جوجل بلاي)، يجب أن يفتح الرابط في متصفح كروم <span className="text-primary font-black">الكامل</span>.
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    إذا فتحت الرابط من الواتساب، اضغط على النقاط الثلاث <i className="fas fa-ellipsis-v text-primary mx-1 text-base"></i> <span className="text-red-600 font-black">بالأعلى</span> واختر <span className="text-primary font-black">"فتح في متصفح كروم" (Open in Chrome)</span>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    انتظر ثوانٍ وسيظهر لك زر التثبيت أسفل الشاشة أو في القائمة (التثبيت كالتطبيقات الأصلية).
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    في حال لم يظهر، اضغط على النقاط الثلاث <i className="fas fa-ellipsis-v text-primary mx-1 text-base"></i> واختر <span className="text-primary font-black">"تثبيت التطبيق" (Install App)</span> ولن يكون مجرد اختصار، بل تطبيق كامل!
                  </p>
                </div>
              </div>
            )}

            {/* TAB: iOS */}
            {installTab === 'ios' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  خطوات تثبيت التطبيق على أجهزة الآيفون والآيباد:
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على زر المشاركة <i className="fas fa-share-square text-primary mx-1 text-base"></i> في أسفل شاشة متصفح Safari.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    قم بالتمرير لأسفل القائمة واضغط على <span className="text-primary font-black">"إضافة إلى الشاشة الرئيسية"</span> (Add to Home Screen).
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على كلمة "إضافة" (Add) في أعلى اليسار لتثبيت التطبيق بنجاح!
                  </p>
                </div>
              </div>
            )}

            {/* TAB: Computer */}
            {installTab === 'pc' && (
              <div className="space-y-4 text-right mb-6 animate-fade-in">
                <p className="text-gray-700 font-bold mb-4 text-sm sm:text-base text-center leading-relaxed">
                  خطوات تثبيت التطبيق على الكمبيوتر (ويندوز أو ماك):
                </p>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">١</span>
                  <p className="text-sm font-bold text-gray-800">
                    افتح المنصة من خلال متصفح <span className="text-primary font-black">Google Chrome</span> أو <span className="text-primary font-black">Microsoft Edge</span> على حاسوبك.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٢</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على زر التثبيت الصغير <i className="fas fa-plus-circle text-primary mx-1 text-base animate-pulse"></i> (أو السهم لأسفل) الذي يظهر في شريط العنوان (URL bar) بالجهة اليسرى/اليمنى بجوار النجمة.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="bg-secondary text-white font-black w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5">٣</span>
                  <p className="text-sm font-bold text-gray-800">
                    اضغط على <span className="text-primary font-black">"تثبيت" (Install)</span> وسيظهر البرنامج فوراً بأيقونة واضحة على سطح المكتب الخاص بك ليفتح بشكل سريع ومستقل!
                  </p>
                </div>
              </div>
            )}

            <button 
              onClick={() => setShowIOSInstallGuide(false)} 
              className="w-full bg-primary text-white font-black text-lg py-3 rounded-xl hover:bg-gray-900 transition-colors shadow-md cursor-pointer"
            >
              فهمت، شكراً 👍
            </button>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className={`rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative text-center flex flex-col max-h-[90dvh] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
            <button 
              onClick={() => setShowLeaderboard(false)} 
              className={`absolute top-4 left-4 cursor-pointer transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            
            <div className="shrink-0">
              <i className="fas fa-crown text-5xl text-gold mb-3 block drop-shadow-md"></i>
              <h2 className={`text-2xl sm:text-3xl font-black mb-1 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>أوائل الكنز</h2>
              <p className={`text-sm font-bold mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>أبطال المنصة مقسمين حسب متوسط درجاتهم</p>
            </div>

            {leaderboardData.length > 0 && (
              <div className="w-full bg-slate-900 overflow-hidden py-3 px-3 rounded-xl mb-4 flex items-center shadow-inner border border-slate-700 relative shrink-0">
                <style>{`
                  @keyframes stockTickerRight {
                    0% { transform: translateX(-150%); }
                    100% { transform: translateX(100%); }
                  }
                  .animate-stock-ticker {
                    display: flex;
                    white-space: nowrap;
                    animation: stockTickerRight 30s linear infinite;
                  }
                  .animate-stock-ticker:hover {
                    animation-play-state: paused;
                  }
                `}</style>
                <div className="absolute right-0 top-0 bottom-0 bg-slate-900 z-10 px-3 flex items-center shadow-[-5px_0_15px_rgba(15,23,42,1)] border-l border-slate-700">
                  <i className="fas fa-chart-line text-xl text-emerald-400 animate-pulse"></i>
                  <span className="mr-2 font-black text-xs text-white">بورصة الأبطال</span>
                </div>
                <div className="flex-1 overflow-hidden relative mr-28" dir="ltr">
                  <div className="animate-stock-ticker gap-6 items-center flex-row">
                    {leaderboardData.filter(s => s.trend === 'up' || s.trend === 'down').length > 0 
                      ? leaderboardData.filter(s => s.trend === 'up' || s.trend === 'down').slice(0, 15).map((s, i) => (
                          <span key={i} className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 shadow-sm text-xs sm:text-sm font-bold ${s.trend === 'up' ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800' : 'bg-rose-900/50 text-rose-400 border-rose-800'}`}>
                            {s.trend === 'up' ? <i className="fas fa-arrow-trend-up"></i> : <i className="fas fa-arrow-trend-down"></i>}
                            <span dir="rtl" className={s.trend === 'up' ? 'text-emerald-300' : 'text-rose-300'}>{s.name.split(' ').slice(0, 3).join(' ')}</span>
                            <span className={`text-[10px] ${s.trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>({toEasternArabic(s.score)})</span>
                          </span>
                        ))
                      : <span className="text-emerald-400 font-bold text-sm" dir="rtl">📊 ترقبوا التغيرات في مستويات الأبطال... المنافسة تشتعل! 🔥</span>}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
              {isLoadingLeaderboard ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <i className="fas fa-spinner fa-spin text-3xl text-secondary"></i>
                  <p className={`font-bold ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>جاري جلب بيانات الأبطال...</p>
                </div>
              ) : leaderboardData.length > 0 ? (
                <div className="flex flex-col gap-3 pb-2">
                  {leaderboardData.map((student, idx) => {
                    const prevTier = idx > 0 ? leaderboardData[idx - 1].tier : '';
                    const showHeader = student.tier !== prevTier;
                    
                    const isGold = student.tier === 'gold';
                    const isSilver = student.tier === 'silver';
                    const isBronze = student.tier === 'bronze';
                    
                    return (
                    <React.Fragment key={idx}>
                      {showHeader && isGold && (
                        <div className="flex flex-col items-center mt-2 mb-2 gap-2">
                          <div className="text-center font-black text-gold text-lg">🏆 القائمة الذهبية (أول ١٠ أبطال) 🏆</div>
                          <button onClick={() => downloadTierBoard('gold', 'القائمة الذهبية', '#d97706')} className="bg-amber-100 text-amber-800 text-xs font-black py-1.5 px-4 rounded-full border border-amber-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      {showHeader && isSilver && (
                        <div className="flex flex-col items-center mt-6 mb-2 gap-2">
                          <div className="text-center font-black text-slate-500 text-lg">🥈 القائمة الفضية (من ١١ إلى ٢٠) 🥈</div>
                          <button onClick={() => downloadTierBoard('silver', 'القائمة الفضية', '#64748b')} className="bg-slate-100 text-slate-700 text-xs font-black py-1.5 px-4 rounded-full border border-slate-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      {showHeader && isBronze && (
                        <div className="flex flex-col items-center mt-6 mb-2 gap-2">
                          <div className="text-center font-black text-orange-600 text-lg">🥉 القائمة البرونزية (من ٢١ إلى ٣٠) 🥉</div>
                          <button onClick={() => downloadTierBoard('bronze', 'القائمة البرونزية', '#ea580c')} className="bg-orange-100 text-orange-800 text-xs font-black py-1.5 px-4 rounded-full border border-orange-300 shadow-sm active:scale-95 transition-all flex items-center gap-2"><i className="fas fa-download"></i> تنزيل ومشاركة القائمة</button>
                        </div>
                      )}
                      
                      <div className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-transform hover:-translate-y-1 ${isGold ? (isDarkMode ? 'bg-amber-900/30 border-gold' : 'bg-amber-50 border-gold') : isSilver ? (isDarkMode ? 'bg-slate-800 border-slate-400' : 'bg-slate-50 border-slate-300') : (isDarkMode ? 'bg-orange-950/30 border-orange-700' : 'bg-orange-50 border-orange-300')}`}>
                      <div className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            {isGold && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[12px]"><i className="fas fa-crown text-amber-400 drop-shadow-sm"></i></div>}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg shadow-inner ${isGold ? 'bg-gold text-white shadow-yellow-400/50' : isSilver ? 'bg-slate-400 text-white' : 'bg-orange-600 text-white'}`}>
                              {idx + 1}
                            </div>
                          </div>
                        <div className="flex flex-col items-start text-right">
                          <span className={`font-black text-sm sm:text-base ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>{student.name.split(' ').slice(0, 4).join(' ')}</span>
                          <span className={`text-[10px] sm:text-xs font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{student.testsCount} اختبارات | متوسط %{toEasternArabic(student.avg || 0)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 pl-1">
                        <div className="flex flex-col items-center justify-center w-8">
                          {student.trend === 'up' && <i className="fas fa-arrow-trend-up text-emerald-500 animate-bounce text-xl" title="مستوى صاعد"></i>}
                          {student.trend === 'down' && <i className="fas fa-arrow-trend-down text-rose-500 animate-pulse text-xl" title="مستوى هابط"></i>}
                          {student.trend === 'flat' && <i className="fas fa-minus text-gray-400 text-lg" title="مستوى مستقر"></i>}
                        </div>
                        <div className="flex flex-col items-end w-14">
                          <span className={`font-black text-lg ${isGold ? 'text-gold' : (isDarkMode ? 'text-secondary' : 'text-primary')}`} dir="ltr">{toEasternArabic(student.score)}</span>
                        <span className={`text-[9px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>نقطة</span>
                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className={`py-10 font-bold px-4 leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  لا توجد بيانات متاحة في هذه الفئات بعد.
                </div>
              )}

              {!isLoadingLeaderboard && studentName && (currentUserStats?.globalRank ?? 0) > 0 && (
                <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} flex flex-col items-center gap-3 shrink-0`}>
                  <div className={`w-full p-3 rounded-2xl border-2 flex items-center justify-between ${isDarkMode ? 'bg-indigo-900/30 border-indigo-700' : 'bg-indigo-50 border-indigo-300'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-lg bg-indigo-600 text-white shadow-inner">
                        {currentUserStats!.globalRank}
                      </div>
                      <div className="flex flex-col items-start text-right">
                        <span className={`font-black text-sm sm:text-base ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>ترتيبك الإجمالي</span>
                        <span className={`text-[10px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>على مستوى المنصة للمؤهلين</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className={`font-black text-lg ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`} dir="ltr">{toEasternArabic(currentUserStats!.avg)}%</span>
                      <span className={`text-[9px] font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>متوسطك</span>
                    </div>
                  </div>
                </div>
              )}

              {!leaderboardData.some(s => s.name === studentName) && !isLoadingLeaderboard && studentName && (
                <div className={`${(currentUserStats?.globalRank ?? 0) > 0 ? 'mt-3' : 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'} flex flex-col items-center gap-3 pb-4 shrink-0`}>
                  <p className={`text-sm font-bold ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>لم تجد اسمك في لوحة الشرف؟</p>
                  <button 
                    onClick={() => setShowWhyModal(true)}
                    className={`border-2 font-black py-2 px-6 rounded-xl transition-colors flex items-center gap-2 shadow-sm active:scale-95 ${isDarkMode ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300 hover:bg-indigo-800' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300'}`}
                  >
                    <i className="fas fa-question-circle"></i> لماذا لم أُكتب؟
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showWhyModal && (
        <div className="fixed inset-0 bg-black/80 z-[1001] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className={`rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative flex flex-col max-h-[90dvh] ${isDarkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
            <button 
              onClick={() => setShowWhyModal(false)} 
              className={`absolute top-4 left-4 cursor-pointer transition-colors ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <i className="fas fa-times-circle text-2xl"></i>
            </button>
            <div className="text-center mb-4 shrink-0">
              <i className="fas fa-search text-4xl text-indigo-500 mb-3 drop-shadow-sm"></i>
              <h2 className={`text-2xl font-black mb-1 ${isDarkMode ? 'text-gray-100' : 'text-primary'}`}>شفافية التقييم</h2>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 text-sm sm:text-base font-bold leading-relaxed space-y-4">
              {!currentUserStats ? (
                <div className={`p-4 rounded-xl text-center ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                  لم تقم بحل أي اختبارات بعد، أو أنك قمت بتصفير بياناتك مؤخراً ولم ترسل إجابات جديدة.
                </div>
              ) : (
                <React.Fragment>
                  <div className={`p-4 rounded-xl border flex flex-col gap-4 ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <div>
                      <h3 className="text-indigo-600 dark:text-indigo-400 font-black mb-3 border-b border-indigo-200 dark:border-indigo-800 pb-2 text-base">حالة الدروس الإجبارية للانضمام:</h3>
                      
                      {currentUserStats.completedRequired && currentUserStats.completedRequired.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-2">
                            <i className="fas fa-check-circle mr-1"></i> الدروس التي قمت بحلها:
                          </p>
                          <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                            {currentUserStats.completedRequired.map((lesson, i) => (
                              <div key={i} className={`flex justify-between items-center text-xs p-2 rounded-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'} shadow-sm`}>
                                <span className="truncate max-w-[75%] text-right font-bold">{lesson.name}</span>
                                <span className={`font-black px-2 py-1 rounded-md ${lesson.score >= 85 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`} dir="ltr">{toEasternArabic(lesson.score)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {currentUserStats.missingRequired && currentUserStats.missingRequired.length > 0 && (
                        <div>
                          <p className="text-sm font-bold text-rose-600 dark:text-rose-400 mb-2">
                            <i className="fas fa-exclamation-circle mr-1"></i> دروس متبقية (يجب حلها):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {currentUserStats.missingRequired.map((lessonName, i) => (
                              <span key={i} className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border shadow-sm ${isDarkMode ? 'bg-rose-950/30 text-rose-300 border-rose-800' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                {lessonName}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {!currentUserStats.passedEnough && (
                        <p className={`mt-3 font-black text-xs p-3 rounded-xl border text-center ${isDarkMode ? 'bg-orange-950/30 text-orange-400 border-orange-800' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                          لكي تدخل المنافسة، يجب عليك الانتهاء من جميع الدروس الإجبارية!
                        </p>
                      )}
                      
                      {timerMode === 'custom_lessons' && (
                        <div className="mb-4 animate-fade-in">
                          <label className="block text-gray-700 font-bold mb-2">اختر الاختبارات المستهدفة:</label>
                          <div className="flex flex-col gap-4 max-h-64 overflow-y-auto custom-scrollbar p-2 border-2 border-gray-200 rounded-xl bg-gray-50">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                <div className="font-black text-primary mb-2 border-b pb-2">{u.title}</div>
                                <div className="flex flex-col gap-2 pl-4">
                                  {u.lessons.map(l => (
                                    <label key={l.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={timerUnitTargets.includes(l.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setTimerUnitTargets(prev => [...prev, l.id]);
                                          } else {
                                            setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                          }
                                        }}
                                        className="w-4 h-4 accent-secondary"
                                      />
                                      <span className="font-bold text-gray-700 text-sm">{l.title}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {timerMode === 'custom_lessons' && (
                        <div className="mb-4 animate-fade-in">
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-gray-700 font-bold">اختر الاختبارات المستهدفة:</label>
                            <button 
                              onClick={() => {
                                const allLessonIds = data.flatMap(u => u.lessons.map(l => l.id));
                                if (timerUnitTargets.length === allLessonIds.length) {
                                  setTimerUnitTargets([]);
                                } else {
                                  setTimerUnitTargets(allLessonIds);
                                }
                              }}
                              className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded-lg font-bold transition-colors"
                            >
                              {timerUnitTargets.length > 0 && timerUnitTargets.length === data.flatMap(u => u.lessons.map(l => l.id)).length ? 'إلغاء التحديد' : 'تحديد الكل'}
                            </button>
                          </div>
                          <div className="flex flex-col gap-4 max-h-64 overflow-y-auto custom-scrollbar p-2 border-2 border-gray-200 rounded-xl bg-gray-50">
                            {data.filter(u => u.lessons.length > 0).map(u => (
                              <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                                <div className="font-black text-primary mb-2 border-b pb-2">{u.title}</div>
                                <div className="flex flex-col gap-2 pl-4">
                                  {u.lessons.map(l => (
                                    <label key={l.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={timerUnitTargets.includes(l.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setTimerUnitTargets(prev => [...prev, l.id]);
                                          } else {
                                            setTimerUnitTargets(prev => prev.filter(id => id !== l.id));
                                          }
                                        }}
                                        className="w-4 h-4 accent-secondary"
                                      />
                                      <span className="font-bold text-gray-700 text-sm">{l.title}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <h3 className="text-indigo-600 dark:text-indigo-400 font-black mb-2 border-b border-indigo-200 dark:border-indigo-800 pb-2">متوسط درجاتك:</h3>
                    <p className="text-center font-black text-2xl my-3" dir="ltr">{toEasternArabic(currentUserStats.avg)}%</p>
                    <p className="text-xs text-center font-bold text-gray-500 dark:text-gray-400">الترتيب يعتمد على إجمالي النقاط ثم عدد الاختبارات.</p>
                    {currentUserStats.passedEnough && (
                      <p className="mt-3 text-emerald-600 text-center font-black text-xs bg-emerald-50 dark:bg-emerald-900/30 p-2.5 rounded-lg">لقد حققت شروط الانضمام! استمر في زيادة نقاطك لرفع ترتيبك في القائمة.</p>
                    )}
                  </div>
                </React.Fragment>
              )}

              {currentUserStats && currentUserStats.unitRanks && Object.keys(currentUserStats.unitRanks).length > 0 && (
                <div className={`mt-4 p-4 rounded-xl border ${isDarkMode ? 'bg-gray-700/50 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                    <h3 className="text-emerald-600 dark:text-emerald-400 font-black mb-3 border-b border-emerald-200 dark:border-emerald-800 pb-2 text-base">
                        <i className="fas fa-chart-pie mr-2"></i>
                        ترتيبك على مستوى الوحدات المكتملة:
                    </h3>
                    <div className="space-y-3">
                        {Object.values(currentUserStats.unitRanks).map(unitStat => (
                            <div key={unitStat.title} className={`p-3 rounded-lg border flex justify-between items-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'} shadow-sm`}>
                                <div className="flex flex-col items-start">
                                    <span className="font-bold text-sm truncate max-w-[180px]">{unitStat.title}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-bold">
                                        ترتيبك: {toEasternArabic(unitStat.rank)} من {toEasternArabic(unitStat.totalStudents)}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="font-black text-emerald-600 dark:text-emerald-400 text-lg" dir="ltr">{toEasternArabic(unitStat.avg)}%</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-bold">متوسطك</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
              )}

              <div className="mt-4 bg-amber-50 border-2 border-amber-300 p-4 rounded-2xl shadow-inner text-amber-900 text-center animate-pulse">
                <i className="fas fa-lightbulb text-2xl text-amber-500 mb-2 block"></i>
                <p className="text-sm font-black leading-relaxed">
                  (بص التفوق مش بسهولة هنتعب شوية قم بتصفير الدرس ثم ابدأ من جديد اعلم انه قد يكون متعبا ولكن لحظة التفوق لو فتحت لك فرصة اغتنمها)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Certificate Modal */}
      {showCertModal && screen === 'result' && activeLesson && (() => {
        const activeUnit = data.find(u => u.lessons.some(l => l.id === activeLesson.id));
        const correct = userAnswers.filter(a => a.isCorrect).length;
        let totalUnitQs = 0; let totalUnitCorrect = 0;
        if (activeUnit) {
          activeUnit.lessons.forEach(l => {
            totalUnitQs += l.questions.length;
            if (l.id === activeLesson.id) {
               const firstAttemptScore = lessonScores[l.id] !== undefined ? lessonScores[l.id] : correct;
               totalUnitCorrect += Math.min(l.questions.length, firstAttemptScore);
            } else {
               totalUnitCorrect += Math.min(l.questions.length, (lessonScores[l.id] || 0));
            }
          });
        }
        const unitPerc = totalUnitQs > 0 ? Math.min(100, Math.round((totalUnitCorrect / totalUnitQs) * 100)) : 0;
        const unitTitle = activeUnit?.title || activeLesson.title;

        return (
          <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4 animate-fade-in" dir="rtl">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl relative text-center flex flex-col items-center">
            <button
              onClick={() => setShowCertModal(false)}
              className="absolute top-4 left-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors z-10"
            >
              <i className="fas fa-times-circle text-3xl"></i>
            </button>

            {/* HTML Certificate Preview (For UI Viewing) */}
            <div className="w-full relative bg-gradient-to-br from-slate-50 to-slate-200 border-8 border-double border-gold p-6 sm:p-10 mb-6 mt-4 shadow-inner rounded-xl overflow-hidden">
              <div className="absolute inset-0 border-2 border-primary m-2 rounded-lg opacity-50 pointer-events-none"></div>
              <i className="fas fa-award text-5xl sm:text-6xl text-gold mb-3 sm:mb-4 drop-shadow-md"></i>
              <h2 className="text-2xl sm:text-4xl font-black text-primary mb-3 sm:mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>شكر وتقدير</h2>
              <p className="text-gray-600 font-bold mb-3 sm:mb-4 text-xs sm:text-base">يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :</p>
              <h3 className="text-2xl sm:text-4xl font-black text-gold mb-4 sm:mb-6">{studentName}</h3>
              <p className="text-gray-600 font-bold mb-2 text-xs sm:text-base leading-relaxed">نظراً لمجهوده وتفانيه لإتمام <span className="text-secondary font-black">{unitTitle}</span> ببراعة وعبقرية بنسبة <span className="text-primary font-black" dir="ltr">{toEasternArabic(unitPerc)}%</span>.</p>
              <p className="text-pink-600 font-black mb-4 sm:mb-6 text-sm sm:text-lg">أكمل يا بطلي فحقا فخور بك ❤️</p>
              
              <div className="flex justify-between items-end mt-4 sm:mt-8 pt-4 border-t-2 border-gray-300 border-dashed">
                <div className="text-center w-1/3">
                  <p className="text-gray-800 font-black text-sm sm:text-lg mb-1">أ/ إسلام سعود</p>
                  <p className="text-gray-500 font-bold text-[8px] sm:text-xs">معلم مادة التاريخ</p>
                </div>
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gold text-white rounded-full flex items-center justify-center font-black text-sm sm:text-xl shadow-lg transform -rotate-12 border-2 border-yellow-200">
                  {toEasternArabic(unitPerc)}%
                </div>
                <div className="text-center w-1/3">
                  <p className="text-gray-500 font-bold text-[9px] sm:text-sm mb-1">تاريخ الاجتياز</p>
                  <p className="text-gray-800 font-black text-[10px] sm:text-sm" dir="ltr">{new Date().toLocaleDateString('ar-EG')}</p>
                </div>
              </div>
            </div>

            {/* Button to Generate and Download Canvas Image */}
            <button
              onClick={() => {
                const canvas = document.createElement('canvas');
                canvas.width = 1000; canvas.height = 700;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                ctx.direction = "rtl";
                const gradient = ctx.createLinearGradient(0, 0, 1000, 700);
                gradient.addColorStop(0, '#f8fafc'); gradient.addColorStop(1, '#e2e8f0');
                ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 700);

                ctx.strokeStyle = '#d97706'; ctx.lineWidth = 15; ctx.strokeRect(30, 30, 940, 640);
                ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = 3; ctx.strokeRect(50, 50, 900, 600);

                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                
                ctx.fillStyle = '#1e3a8a'; ctx.font = 'bold 70px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('شكر وتقدير', 500, 130);
                ctx.fillStyle = '#475569'; ctx.font = 'bold 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('يسر الأستاذ إسلام سعود أن يمنح هذه الشهادة لـ :', 500, 230);
                ctx.fillStyle = '#d97706'; ctx.font = '900 55px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(studentName, 500, 320);
                ctx.fillStyle = '#475569'; ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`نظراً لمجهوده وتفانيه لإتمام (${unitTitle})`, 500, 400);
                ctx.font = 'bold 24px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`ببراعة وعبقرية بنسبة ${toEasternArabic(unitPerc)}%`, 500, 445);
                ctx.fillStyle = '#db2777'; ctx.font = '900 35px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أكمل يا بطلي فحقا فخور بك ❤️', 500, 510);

                ctx.beginPath(); ctx.moveTo(150, 560); ctx.lineTo(850, 560); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.stroke();

                ctx.fillStyle = '#0f172a'; ctx.font = '900 30px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText('أ/ إسلام سعود', 800, 610);
                ctx.fillStyle = '#16a34a'; ctx.font = '900 40px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(`${toEasternArabic(unitPerc)}٪`, 500, 610);
                ctx.fillStyle = '#64748b'; ctx.font = 'bold 25px "Cairo", "Tajawal", "Segoe UI", Arial, sans-serif'; ctx.fillText(new Date().toLocaleDateString('ar-EG'), 200, 610);

                const link = document.createElement('a');
                link.download = `شهادة_تفوق_${studentName.split(' ')[0]}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
              }}
              className="w-full bg-primary text-white font-black text-lg sm:text-xl py-4 rounded-2xl hover:bg-gray-900 transition-colors shadow-md flex items-center justify-center gap-3 cursor-pointer"
            >
              <i className="fas fa-download"></i> تحميل الشهادة كصورة للمشاركة
            </button>
          </div>
        </div>
        );
      })()}

      {/* Global Background Audio Handler (hidden HTML5 Audio tag) */}
      <audio
        ref={globalAudioRef}
        onPlay={() => { setIsGlobalAudioPlaying(true); setIsAudioLoading(false); }}
        onPlaying={() => { setIsGlobalAudioPlaying(true); setIsAudioLoading(false); }}
        onPause={() => setIsGlobalAudioPlaying(false)}
        onWaiting={() => setIsAudioLoading(true)}
        onCanPlay={() => setIsAudioLoading(false)}
        onEnded={() => {
          if (globalAudio) {
            localStorage.removeItem(`audioProgress_${simpleHash(globalAudio.url)}`);
          }
          setIsGlobalAudioPlaying(false);
          setGlobalAudio(null);
        }}
        onTimeUpdate={handleGlobalAudioTimeUpdate}
        onLoadedMetadata={handleGlobalAudioLoadedMetadata}
        onError={(e) => {
          const err = e.currentTarget.error;
          console.error('Audio streaming error:', err);
          // تجاهل الخطأ رقم 1 (Abort) لأنه يحدث طبيعياً عند تغيير مقطع الصوت
          if (err && err.code === 1) return;
          // تجاهل الخطأ في حالة خدعة فك القفل الصوتي للهواتف
          if (globalAudioRef.current && globalAudioRef.current.src.includes('data:audio')) return;
          
          setIsGlobalAudioPlaying(false);
          // تمت إزالة التنبيه المزعج وتصفير الصوت، ليتمكن المستخدم من إعادة المحاولة بالضغط على التشغيل ببساطة
        }}
        className="fixed -top-20 -left-20 w-1 h-1 opacity-0 pointer-events-none"
        preload="none"
        playsInline
        crossOrigin="anonymous"
      />

      {/* Global Background Audio Floating Control Bar */}
      {globalAudio && (
        <div 
          className={`fixed bottom-0 left-0 right-0 md:bottom-4 md:left-auto md:right-4 rounded-t-2xl md:rounded-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] md:shadow-[0_10px_40px_rgba(0,0,0,0.12)] z-[9999] animate-fade-in flex flex-col justify-between border-t md:border ${isDarkMode ? 'bg-gray-900/95 border-gray-800 text-white' : 'bg-white/95 border-blue-50 text-gray-800'} backdrop-blur-md`} 
          style={{
            marginTop: '0px',
            marginLeft: '0px',
            marginRight: '6px',
            paddingTop: '5px',
            paddingBottom: '16px',
            paddingRight: '25px',
            paddingLeft: '17px',
            width: '340px',
            height: '82px',
            marginBottom: '4px'
          }}
          dir="rtl"
        >
          <div className="flex items-center justify-between gap-2.5">
            <div 
              className="flex items-center gap-2 overflow-hidden max-w-[190px]"
              style={{
                paddingRight: '10px',
                paddingLeft: '10px',
                paddingTop: '4px',
                paddingBottom: '5px',
                marginLeft: '-1px',
                marginRight: '-40px'
              }}
            >
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <i className={`fas fa-headphones-alt text-sm ${isGlobalAudioPlaying ? 'animate-bounce' : ''}`}></i>
              </div>
              <div className="overflow-hidden flex flex-col min-w-0">
                <p className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider shrink-0 leading-tight">شرح مسموع في الخلفية 🎧</p>
                <div className="overflow-hidden w-full whitespace-nowrap">
                  <p className={`text-xs font-black whitespace-nowrap inline-block ${isGlobalAudioPlaying ? 'animate-lesson-reveal' : 'truncate'}`}>
                    {globalAudio.title}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 shrink-0">
              <button 
                onClick={togglePlaybackRate} 
                className="w-7 h-7 rounded-full bg-purple-50 dark:bg-gray-800 hover:bg-purple-100 dark:hover:bg-gray-700 text-purple-600 dark:text-purple-400 flex items-center justify-center transition-colors cursor-pointer text-[10px] font-black"
                title="سرعة الصوت"
              >
                {playbackRate}x
              </button>
              <button 
                onClick={toggleGlobalAudio} 
                className="w-7 h-7 rounded-full bg-blue-50 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-colors cursor-pointer text-xs"
                title={isGlobalAudioPlaying ? "إيقاف مؤقت" : "تشغيل"}
                disabled={isAudioLoading}
                style={{
                  marginRight: '1px',
                  marginBottom: '-1px',
                  marginTop: '0px',
                  marginLeft: '3px'
                }}
              >
                {isAudioLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className={`fas ${isGlobalAudioPlaying ? 'fa-pause' : 'fa-play ml-0.5'}`}></i>}
              </button>
              <button 
                onClick={() => {
                  if (globalAudioRef.current) {
                    globalAudioRef.current.pause();
                  }
                  setGlobalAudio(null);
                  setIsGlobalAudioPlaying(false);
                }} 
                className="w-7 h-7 rounded-full bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center transition-colors cursor-pointer text-xs"
                title="إغلاق تماماً"
                style={{
                  marginLeft: '35px'
                }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
          
          {/* Progress bar controller */}
          <div className="flex items-center gap-2 px-0.5 leading-none">
            <span className="text-[9px] font-bold text-gray-500 w-7 text-left" dir="ltr">{formatAudioTime(globalAudioTime)}</span>
            <input 
              type="range" 
              min={0} 
              max={globalAudioDuration || 100} 
              value={globalAudioTime} 
              onChange={handleGlobalAudioSeek} 
              className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <span className="text-[9px] font-bold text-gray-500 w-7 text-right" dir="ltr">{formatAudioTime(globalAudioDuration)}</span>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}
