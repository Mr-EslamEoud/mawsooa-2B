// =========================================================================
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

    // 4.1. جلب سجل المشتركين الأونلاين المعتمدين
    else if (action === 'getOnlineStudents') {
      var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
      if (!onlineSheet) return respondJSON({status: 'success', data: []});
      
      var oData = onlineSheet.getDataRange().getValues();
      var oList = [];
      for (var oi = 1; oi < oData.length; oi++) {
        if (oData[oi][1] || oData[oi][2]) {
          oList.push({
            code: String(oData[oi][0] || '').trim(),
            name: String(oData[oi][1] || '').trim(),
            phone: cleanPhone(oData[oi][2]),
            stage: String(oData[oi][3] || '').trim(),
            packageType: String(oData[oi][4] || '').trim(),
            activeMonths: String(oData[oi][5] || '').trim(),
            method: String(oData[oi][6] || '').trim(),
            amount: String(oData[oi][7] || '').trim(),
            date: String(oData[oi][8] || '').trim(),
            notes: String(oData[oi][9] || '').trim()
          });
        }
      }
      return respondJSON({status: 'success', data: oList});
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


// -------------------------------------------------------------------------
// دوال إدارة وتوليد أكواد طلاب الأونلاين ومزامنتهم
// -------------------------------------------------------------------------
function generateOnlineStudentCode(name, phone) {
  var cleanP = cleanPhone(phone);
  var last4 = cleanP.length >= 4 ? cleanP.slice(-4) : ('0000' + cleanP).slice(-4);
  
  var mapChar = {
    'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ء': 'A',
    'ب': 'B', 'ت': 'T', 'ث': 'T', 'ج': 'G', 'ح': 'H',
    'خ': 'K', 'د': 'D', 'ذ': 'Z', 'ر': 'R', 'ز': 'Z',
    'س': 'S', 'ش': 'S', 'ص': 'S', 'ض': 'D', 'ط': 'T',
    'ظ': 'Z', 'ع': 'A', 'غ': 'G', 'ف': 'F', 'ق': 'K',
    'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H',
    'ة': 'H', 'و': 'W', 'ي': 'Y', 'ى': 'Y'
  };
  
  var firstLetter = 'A';
  if (name && String(name).trim().length > 0) {
    var rawFirst = String(name).trim().charAt(0);
    if (/[a-zA-Z]/.test(rawFirst)) {
      firstLetter = rawFirst.toUpperCase();
    } else if (mapChar[rawFirst]) {
      firstLetter = mapChar[rawFirst];
    }
  }
  
  // التركيبة المعتمدة: [حرف الاسم] + [آخر 4 أرقام] + [ES] + [ON]
  return firstLetter + last4 + "ESON";
}

function syncSingleOnlineStudentToMainSheet(studentsSheet, st) {
  var data = studentsSheet.getDataRange().getValues();
  var headers = data[0];
  var colMap = findColumnIndices(headers);
  var targetPhone = cleanPhone(st.phone);
  
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (cleanPhone(data[i][colMap.phone]) === targetPhone) {
      foundRow = i + 1;
      break;
    }
  }

  var activeMonths = st.activeMonths || [];

  if (foundRow > -1) {
    // الطالب موجود بالفعل في شيت الطلاب: نحدث كوده وحالته والشهور المفعلة
    if (colMap.code > -1 && st.code) studentsSheet.getRange(foundRow, colMap.code + 1).setValue("'" + st.code);
    if (colMap.status > -1) studentsSheet.getRange(foundRow, colMap.status + 1).setValue("أونلاين");
    if (colMap.stage > -1 && st.stage) studentsSheet.getRange(foundRow, colMap.stage + 1).setValue(st.stage);

    activeMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        studentsSheet.getRange(foundRow, mIdx + 1).setValue("مسدد");
      }
    });
  } else {
    // الطالب غير موجود (مثلاً تم مسح الشيت): نضيف صفاً جديداً
    var newRow = new Array(headers.length).fill('');
    if (colMap.name > -1) newRow[colMap.name] = st.name;
    if (colMap.code > -1) newRow[colMap.code] = "'" + st.code;
    if (colMap.status > -1) newRow[colMap.status] = "أونلاين";
    if (colMap.stage > -1) newRow[colMap.stage] = st.stage || "2 بكالوريا";
    if (colMap.gender > -1) newRow[colMap.gender] = "طالب";
    if (colMap.phone > -1) newRow[colMap.phone] = "'" + (targetPhone.startsWith('0') ? targetPhone : ('0' + targetPhone));

    activeMonths.forEach(function(m) {
      var mIdx = headers.indexOf(m);
      if (mIdx > -1) {
        newRow[mIdx] = "مسدد";
      }
    });

    studentsSheet.appendRow(newRow);
  }
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

  // 7. دمج وتأمين طلاب الأونلاين من شيت «طلاب_الأونلاين» (لضمان بقائهم حتى لو مسح الشيت وأعيد بناؤه!)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (onlineSheet) {
    var onData = onlineSheet.getDataRange().getValues();
    if (onData.length > 1) {
      for (var oi = 1; oi < onData.length; oi++) {
        var onCode = String(onData[oi][0] || '').trim();
        var onName = String(onData[oi][1] || '').trim();
        var onPhone = cleanPhone(onData[oi][2]);
        var onStage = String(onData[oi][3] || '').trim() || "2 بكالوريا";
        var onMonthsRaw = String(onData[oi][5] || '').trim();
        var onMonths = onMonthsRaw.split(/[،,]/).map(function(m){ return m.trim(); }).filter(Boolean);

        if (onPhone) {
          syncSingleOnlineStudentToMainSheet(studentsSheet, {
            code: onCode,
            name: onName,
            phone: onPhone,
            stage: onStage,
            activeMonths: onMonths
          });
        }
      }
    }
  }

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

  // 7. شيت طلاب الأونلاين (سجل المشتركين أونلاين الدائم)
  var onlineSheet = ss.getSheetByName("طلاب_الأونلاين");
  if (!onlineSheet) {
    onlineSheet = ss.insertSheet("طلاب_الأونلاين");
    onlineSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "ملاحظات"]);
    onlineSheet.getRange(1, 1, 1, 10).setBackground("#047857").setFontColor("#ffffff").setFontWeight("bold");
    onlineSheet.setFrozenRows(1);
    onlineSheet.getRange("C:C").setNumberFormat("@");
  }

  // 8. شيت أرشيف الأونلاين (سجل الاشتراكات الملغاة والمحذوفة لحفظ الحقوق المالية)
  var archSheet = ss.getSheetByName("أرشيف_الأونلاين");
  if (!archSheet) {
    archSheet = ss.insertSheet("أرشيف_الأونلاين");
    archSheet.appendRow(["كود الطالب", "الاسم", "رقم الهاتف", "المرحلة", "نوع الاشتراك", "الشهور المفعلة", "طريقة الدفع", "المبلغ", "تاريخ التفعيل", "تاريخ الإلغاء", "سبب الإلغاء"]);
    archSheet.getRange(1, 1, 1, 11).setBackground("#991b1b").setFontColor("#ffffff").setFontWeight("bold");
    archSheet.setFrozenRows(1);
    archSheet.getRange("C:C").setNumberFormat("@");
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
