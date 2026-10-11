export const API_URL = "https://script.google.com/macros/s/AKfycbwrVCXzF3FNQjl154emCulyfTznzJcS-OjE5uQtgadhKt5SKmG_XGT24O_r3GZn2an2tQ/exec";
export const SECRET_API_KEY = "Kanz_Secret_2026_Secure";

export interface StudentBase {
  role: string;
  name: string;
  passHash: string;
}

export const BASE_STUDENTS: Record<string, StudentBase> = {
  "01228466613": { role: "admin", name: "eslam", passHash: "343432303034" }, // 442004
  "01205058940": { role: "secretary", name: "mostafa", passHash: "30" } // 0
};

export const subjectName = "التاريخ";
export const gradeName = "2 بكالوريا";
export const PAYMENT_INFO = { fee: "50 جنيهاً", vodafoneCash: "01228466613", instapay: "01228466613" };

export const simpleHash = (str: string): string => {
  if (!str) return '';
  let hex = '';
  for(let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16);
  }
  return hex;
};

export const toEasternArabic = (num: string | number): string => {
  return String(num).split('').map(digit => {
    const arabDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    const idx = parseInt(digit, 10);
    return !isNaN(idx) ? arabDigits[idx] : digit;
  }).join('');
};

export const formatPhoneStr = (phone: string): string => {
  if (!phone) return "";
  let cleaned = String(phone).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s\+\.]/g, "");
  if (cleaned.startsWith("20") && cleaned.length > 10) cleaned = cleaned.substring(2);
  if (cleaned.length === 10 && cleaned.startsWith("1")) cleaned = "0" + cleaned;
  return cleaned;
};

export const generateDeviceFingerprint = (): string => {
  try {
    const canvas = document.createElement('canvas'); 
    const ctx = canvas.getContext('2d');
    if (!ctx) return Math.random().toString(16).substring(2, 10);
    ctx.textBaseline = "top"; 
    ctx.font = "14px 'Arial'"; 
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60"; 
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069"; 
    ctx.fillText("EdTech-Fingerprint", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)"; 
    ctx.fillText("EdTech-Fingerprint", 4, 17);
    const b64 = canvas.toDataURL().replace("data:image/png;base64,","");
    const bin = atob(b64);
    
    const crc32 = function(r: string): number {
      const o: number[] = [];
      for (let c = 0; c < 256; c++) {
        let a = c;
        for (let f = 0; f < 8; f++) {
          a = 1 & a ? 3988292384 ^ (a >>> 1) : a >>> 1;
        }
        o[c] = a;
      }
      let n = -1;
      for (let t = 0; t < r.length; t++) {
        n = (n >>> 8) ^ o[255 & (n ^ r.charCodeAt(t))];
      }
      return (-1 ^ n) >>> 0;
    };
    
    return crc32(bin).toString(16);
  } catch (e) {
    return Math.random().toString(16).substring(2, 10);
  }
};

export const getDirectAudioLink = (url: string): string => {
  if (!url) return '';
  // تحويل روابط جوجل درايف للبروكسي الخاص بنا لتخطي حظر الموبايل ودعم الاستكمال (Range Requests)
  if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
    const match = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
  }
  // بما أنك تستخدم Archive.org، نقوم بإرجاع الرابط كما هو ليعمل مباشرة داخل التطبيق
  // تحويل أي رابط http إلى https إجبارياً لأن تطبيقات PWA تمنع تشغيل المحتوى غير الآمن
  return url.replace('http://', 'https://');
};

export const getYoutubeEmbedLink = (url: string): string => {
  if (!url) return '';
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) return `https://www.youtube.com/embed/${match[2]}?playsinline=1&rel=0`;
  return url;
};
