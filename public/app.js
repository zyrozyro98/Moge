// Antigravity Mailer - Core Client-Side Logic

let recipientsList = [];
let availableVariables = ['name', 'email'];
let sseSource = null;
let activePreviewIndex = 0;
let selectedAttachments = []; // List of selected files to attach

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
  // Fetch Saved SMTP Config
  fetchSmtpConfig();
  
  // Connect to SSE for background campaigns status
  connectStatusSSE();

  // Initialize Event Listeners
  initEventListeners();
});

// Switch Dashboard Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabId).classList.add('active');
  
  // Find button corresponding to tab and activate it
  const btnMap = {
    'smtp-tab': 0,
    'recipients-tab': 1,
    'composer-tab': 2
  };
  const activeBtn = document.querySelectorAll('.tab-btn')[btnMap[tabId]];
  if (activeBtn) activeBtn.classList.add('active');
}

// Toast Alert System
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-circle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `
    <i class="fa-solid ${icons[type]} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.5s forwards';
    setTimeout(() => toast.remove(), 500);
  }, 5000);
}

// 1. SMTP API Communications
async function fetchSmtpConfig() {
  try {
    const res = await fetch('/api/config');
    const result = await res.json();
    if (result.success && result.data) {
      const config = result.data;
      document.getElementById('smtpHost').value = config.host || '';
      document.getElementById('smtpPort').value = config.port || 587;
      document.getElementById('smtpSecure').checked = config.secure || false;
      document.getElementById('smtpUser').value = config.user || '';
      document.getElementById('smtpPass').value = config.hasPassword ? '••••••••••••••••' : '';
      document.getElementById('fromName').value = config.fromName || 'نظام الإرسال الجماعي';
      document.getElementById('fromEmail').value = config.fromEmail || '';
    }
  } catch (err) {
    showToast('خطأ بالنظام', 'تعذر جلب إعدادات SMTP من الخادم.', 'error');
  }
}

// Initialize Event Listeners
function initEventListeners() {
  // SMTP Form Submit
  const smtpForm = document.getElementById('smtpForm');
  smtpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const host = document.getElementById('smtpHost').value;
    const port = document.getElementById('smtpPort').value;
    const secure = document.getElementById('smtpSecure').checked;
    const user = document.getElementById('smtpUser').value;
    const pass = document.getElementById('smtpPass').value;
    const fromName = document.getElementById('fromName').value;
    const fromEmail = document.getElementById('fromEmail').value;

    const btn = document.getElementById('btnSaveSmtp');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, secure, user, pass, fromName, fromEmail })
      });
      const result = await res.json();
      if (result.success) {
        showToast('تم بنجاح', 'تم حفظ إعدادات خادم SMTP بنجاح!', 'success');
        fetchSmtpConfig(); // Reload
      } else {
        showToast('خطأ في الحفظ', result.message || 'فشل حفظ الإعدادات.', 'error');
      }
    } catch (err) {
      showToast('خطأ في الاتصال', 'تعذر الاتصال بالخادم الرئيسي.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  // SMTP Test Connection Button
  const btnTestSmtp = document.getElementById('btnTestSmtp');
  btnTestSmtp.addEventListener('click', async () => {
    const host = document.getElementById('smtpHost').value;
    const port = document.getElementById('smtpPort').value;
    const secure = document.getElementById('smtpSecure').checked;
    const user = document.getElementById('smtpUser').value;
    const pass = document.getElementById('smtpPass').value;

    if (!host || !user || !pass) {
      showToast('حقول مطلوبة', 'يرجى ملء المضيف، اسم المستخدم وكلمة المرور لتجربة الاتصال.', 'warning');
      return;
    }

    const originalText = btnTestSmtp.innerHTML;
    btnTestSmtp.disabled = true;
    btnTestSmtp.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري فحص الاتصال بالخادم...';

    try {
      const res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, secure, user, pass })
      });
      const result = await res.json();
      if (result.success) {
        showToast('نجاح الاتصال', result.message, 'success');
      } else {
        showToast('فشل الاتصال', result.message, 'error');
      }
    } catch (err) {
      showToast('خطأ بالخادم', 'تعذر إجراء فحص الاتصال بـ SMTP.', 'error');
    } finally {
      btnTestSmtp.disabled = false;
      btnTestSmtp.innerHTML = originalText;
    }
  });

  // CSV Drag and Drop Actions
  const dragZone = document.getElementById('csvDragZone');
  const fileInput = document.getElementById('csvFileInput');

  dragZone.addEventListener('click', () => fileInput.click());

  dragZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragZone.classList.add('dragover');
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dragZone.addEventListener(eventName, () => dragZone.classList.remove('dragover'));
  });

  dragZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleCsvFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleCsvFile(e.target.files[0]);
    }
  });

  // Manual Parsing Action
  const btnParseManual = document.getElementById('btnParseManual');
  btnParseManual.addEventListener('click', () => {
    const rawText = document.getElementById('manualRecipients').value.trim();
    if (!rawText) {
      showToast('مدخلات فارغة', 'برجاء لصق بعض العناوين أولاً للمعالجة.', 'warning');
      return;
    }
    parseManualInputs(rawText);
  });

  // Clear Recipients list
  const btnClearRecipients = document.getElementById('btnClearRecipients');
  btnClearRecipients.addEventListener('click', () => {
    recipientsList = [];
    document.getElementById('previewContainer').classList.add('hide');
    document.getElementById('recipientsCountBadge').innerText = '0';
    showToast('تم تفريغ القائمة', 'تم مسح جميع جهات الاتصال من المسودة.', 'info');
    updateLivePreview();
  });

  // Textarea input triggers preview compiler
  document.getElementById('mailSubject').addEventListener('input', updateLivePreview);
  document.getElementById('mailBody').addEventListener('input', updateLivePreview);

  // Sending Delay Slider Display
  const sendingDelay = document.getElementById('sendingDelay');
  sendingDelay.addEventListener('input', (e) => {
    document.getElementById('delayDisplay').innerText = e.target.value;
  });

  // Launch Campaign
  const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
  btnLaunchCampaign.addEventListener('click', launchCampaign);

  // Campaign Control actions
  document.getElementById('btnPauseCampaign').addEventListener('click', pauseCampaign);
  document.getElementById('btnResumeCampaign').addEventListener('click', resumeCampaign);
  document.getElementById('btnStopCampaign').addEventListener('click', stopCampaign);

  // Clear Logs
  document.getElementById('btnClearLogs').addEventListener('click', () => {
    document.getElementById('terminalLogsBody').innerHTML = '';
  });

  // Attachments Drag & Drop and Upload Event Listeners
  const attachmentsDropZone = document.getElementById('attachmentsDropZone');
  const emailAttachmentsInput = document.getElementById('emailAttachments');

  attachmentsDropZone.addEventListener('click', () => emailAttachmentsInput.click());

  attachmentsDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    attachmentsDropZone.style.borderColor = 'var(--accent-cyan)';
    attachmentsDropZone.style.background = 'rgba(6, 182, 212, 0.05)';
  });

  ['dragleave', 'drop'].forEach(eventName => {
    attachmentsDropZone.addEventListener(eventName, () => {
      attachmentsDropZone.style.borderColor = '';
      attachmentsDropZone.style.background = '';
    });
  });

  attachmentsDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      addAttachments(files);
    }
  });

  emailAttachmentsInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addAttachments(e.target.files);
    }
  });
}

// 2. Parsers (CSV & Manual text)
function handleCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parseCSVData(text);
  };
  reader.readAsText(file, 'utf-8');
}

function parseCSVData(text) {
  // Detect standard CSV separators (comma, semicolon, tab)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
  if (lines.length === 0) {
    showToast('ملف فارغ', 'لا يحتوي ملف CSV المرفوع على أي بيانات.', 'warning');
    return;
  }

  const firstLine = lines[0];
  let sep = ',';
  if (firstLine.includes(';')) sep = ';';
  else if (firstLine.includes('\t')) sep = '\t';

  const clean = (val) => val ? val.replace(/^["']|["']$/g, '').trim() : '';

  // Parse lines considering quoted strings
  const parseLine = (line) => {
    let result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      let char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === sep && !inQuotes) {
        result.push(clean(current));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(clean(current));
    return result;
  };

  const headers = parseLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length === 0 || (vals.length === 1 && vals[0] === '')) continue;
    
    const obj = {};
    headers.forEach((header, index) => {
      // Map to standardized variables inside system (keep lowercase)
      const standardKey = header.toLowerCase().trim();
      obj[standardKey] = vals[index] || '';
    });
    records.push(obj);
  }

  if (records.length === 0) {
    showToast('بيانات غير مقروءة', 'تعذر استخراج جهات اتصال صالحة من الملف.', 'error');
    return;
  }

  // Set the system variables
  recipientsList = records;
  availableVariables = headers.map(h => h.toLowerCase().trim());
  
  showToast('نجاح الاستيراد', `تم استيراد ${records.length} جهة اتصال بنجاح من الملف!`, 'success');
  buildPreviewTable(headers);
  buildVariableBadges();
  
  // Switch to recipients tab automatically to see beautiful sheet preview
  switchTab('recipients-tab');
}

function parseManualInputs(text) {
  const lines = text.split('\n');
  const tempRecords = [];
  
  lines.forEach(line => {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length >= 1 && parts[0] !== '') {
      const email = parts[0];
      const name = parts[1] || email.split('@')[0];
      const company = parts[2] || '';
      
      // Basic validate email
      if (email.includes('@')) {
        tempRecords.push({ email, name, company });
      }
    }
  });

  if (tempRecords.length === 0) {
    showToast('معالجة غير صالحة', 'لم نتمكن من العثور على أي بريد إلكتروني صالح باللصق اليدوي.', 'warning');
    return;
  }

  recipientsList = recipientsList.concat(tempRecords);
  availableVariables = ['email', 'name', 'company'];
  
  showToast('إضافة ناجحة', `تمت إضافة ${tempRecords.length} جهة اتصال يدوياً للمسودة!`, 'success');
  buildPreviewTable(['email', 'name', 'company']);
  buildVariableBadges();
  
  // Reset input field
  document.getElementById('manualRecipients').value = '';
}

// 3. Render and Build HTML Grid Table Preview
function buildPreviewTable(headers) {
  const container = document.getElementById('previewContainer');
  const table = document.getElementById('recipientsTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = '';
  tbody.innerHTML = '';
  
  if (recipientsList.length === 0) {
    container.classList.add('hide');
    return;
  }

  // Build Head
  const trHead = document.createElement('tr');
  // Column 1: Row Indicator
  const thIdx = document.createElement('th');
  thIdx.innerText = '#';
  trHead.appendChild(thIdx);

  // Dynamic headers
  headers.forEach(h => {
    const th = document.createElement('th');
    th.innerText = h.toUpperCase();
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  let validCount = 0;
  let invalidCount = 0;

  // Build Body rows
  recipientsList.forEach((recipient, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;

    // Validate email
    const emailStr = recipient.email || '';
    const isValid = emailStr.includes('@') && emailStr.length > 5;
    
    if (isValid) validCount++;
    else {
      invalidCount++;
      tr.classList.add('invalid-row');
    }

    // Index Column
    const tdIdx = document.createElement('td');
    tdIdx.innerText = idx + 1;
    tr.appendChild(tdIdx);

    // Columns
    headers.forEach(header => {
      const td = document.createElement('td');
      const key = header.toLowerCase().trim();
      td.innerText = recipient[key] || '';
      tr.appendChild(td);
    });

    // Make row clickable to compile live preview
    tr.addEventListener('click', () => {
      activePreviewIndex = idx;
      updateLivePreview();
      
      // Highlight active row visually
      tbody.querySelectorAll('tr').forEach(r => r.style.background = '');
      tr.style.background = 'rgba(139, 92, 246, 0.15)';
    });

    tbody.appendChild(tr);
  });

  // Update badge and counts
  document.getElementById('recipientsCountBadge').innerText = recipientsList.length;
  document.getElementById('parsedTotalCount').innerText = recipientsList.length;
  document.getElementById('validEmailsCount').innerText = validCount;
  document.getElementById('invalidEmailsCount').innerText = invalidCount;

  container.classList.remove('hide');
  
  // Auto select first row for preview on build
  activePreviewIndex = 0;
  updateLivePreview();
}

// 4. Variables Manager & Placeholders
function buildVariableBadges() {
  const container = document.getElementById('dynamicVariablesBadges');
  container.innerHTML = '';

  availableVariables.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'var-badge';
    btn.innerHTML = `<i class="fa-solid fa-code"></i> {{${v}}}`;
    btn.addEventListener('click', () => insertVariable(v));
    container.appendChild(btn);
  });
}

function insertVariable(variableName) {
  const mailBody = document.getElementById('mailBody');
  const start = mailBody.selectionStart;
  const end = mailBody.selectionEnd;
  const text = mailBody.value;
  const before = text.substring(0, start);
  const after = text.substring(end, text.length);
  
  mailBody.value = before + `{{${variableName}}}` + after;
  mailBody.focus();
  mailBody.selectionStart = mailBody.selectionEnd = start + variableName.length + 4; // cursor right after variable
  
  // Trigger update live preview
  updateLivePreview();
}

// 5. Dynamic HTML email compiler & Preview Engine
function updateLivePreview() {
  const previewToEmail = document.getElementById('previewToEmail');
  const previewSubject = document.getElementById('previewSubject');
  const iframe = document.getElementById('emailPreviewIframe');

  if (recipientsList.length === 0) {
    previewToEmail.innerText = 'لم يتم تحديد مستلم';
    previewSubject.innerText = 'لا يوجد موضوع';
    iframe.srcdoc = "<p style='color:#9ca3af; font-family:sans-serif; text-align:center; padding-top:40px;'>اكتب محتوى بريد أو قم بتحديد مستلم من القائمة لمشاهدة معاينة حية بالبيانات الحقيقية هنا.</p>";
    return;
  }

  const recipient = recipientsList[activePreviewIndex] || recipientsList[0];
  const rawSubject = document.getElementById('mailSubject').value || 'لا يوجد موضوع';
  const rawBody = document.getElementById('mailBody').value || '';

  // Inject placeholders
  const parseStr = (str, data) => {
    let result = str;
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      result = result.replace(regex, value || '');
    }
    return result;
  };

  const compiledSubject = parseStr(rawSubject, recipient);
  const compiledBody = parseStr(rawBody, recipient);

  previewToEmail.innerText = `"${recipient.name || 'بدون اسم'}" <${recipient.email}>`;
  previewSubject.innerText = compiledSubject;
  
  // Set iframe safely with sandbox content
  if (compiledBody.trim() === '') {
    iframe.srcdoc = "<p style='color:#9ca3af; font-family:sans-serif; text-align:center; padding-top:40px;'>المحتوى فارغ حالياً.</p>";
  } else {
    // If it's pure HTML, supply it. If not, preserve spacing for normal text
    const isHtml = /<[a-z][\s\S]*>/i.test(compiledBody);
    iframe.srcdoc = isHtml ? compiledBody : `<pre style='font-family: sans-serif; font-size: 14px; white-space: pre-wrap; padding: 15px;'>${compiledBody}</pre>`;
  }
}

// 5.5. Attachment File Helpers
function addAttachments(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Avoid duplicates
    if (!selectedAttachments.some(f => f.name === file.name)) {
      selectedAttachments.push(file);
    }
  }
  renderAttachmentsPreview();
}

function removeAttachment(index) {
  selectedAttachments.splice(index, 1);
  renderAttachmentsPreview();
}

function renderAttachmentsPreview() {
  const container = document.getElementById('attachmentListPreview');
  container.innerHTML = '';
  
  if (selectedAttachments.length === 0) {
    container.classList.add('hide');
    return;
  }

  selectedAttachments.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'uploaded-file-item';
    
    const kb = (file.size / 1024).toFixed(1);
    const sizeStr = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

    item.innerHTML = `
      <div class="file-info">
        <i class="fa-solid fa-paperclip"></i>
        <span class="file-name" title="${file.name}">${file.name}</span>
        <span class="file-size">(${sizeStr})</span>
      </div>
      <button type="button" class="btn-remove-file" onclick="removeAttachment(${index})" title="إزالة الملف">
        <i class="fa-solid fa-circle-xmark"></i>
      </button>
    `;
    container.appendChild(item);
  });

  container.classList.remove('hide');
}

// 6. Campaign Processors API Call
async function launchCampaign() {
  if (recipientsList.length === 0) {
    showToast('عفواً', 'قائمة المستلمين فارغة! يرجى تحميل ملف CSV أو لصق جهات اتصال.', 'warning');
    switchTab('recipients-tab');
    return;
  }

  const subject = document.getElementById('mailSubject').value;
  const htmlTemplate = document.getElementById('mailBody').value;
  const delay = document.getElementById('sendingDelay').value * 1000; // in ms

  if (!subject) {
    showToast('عنوان مطلوب', 'يرجى وضع عنوان للحملة البريدية.', 'warning');
    document.getElementById('mailSubject').focus();
    return;
  }
  if (!htmlTemplate) {
    showToast('محتوى مطلوب', 'محتوى الرسالة فارغ!', 'warning');
    document.getElementById('mailBody').focus();
    return;
  }

  const btn = document.getElementById('btnLaunchCampaign');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري استنفار خوادم الإرسال وإطلاق الحملة...';

  // Construct Multipart Form Data
  const formData = new FormData();
  formData.append('recipients', JSON.stringify(recipientsList));
  formData.append('subject', subject);
  formData.append('htmlTemplate', htmlTemplate);
  formData.append('delay', delay);

  // Attach all files
  selectedAttachments.forEach(file => {
    formData.append('attachments', file);
  });

  try {
    const res = await fetch('/api/campaign/start', {
      method: 'POST',
      body: formData // Fetch will automatically set the correct multipart boundaries
    });

    const result = await res.json();
    if (result.success) {
      showToast('انطلقت الحملة', result.message, 'success');
      
      // Auto reconnect/force update SSE
      connectStatusSSE();
    } else {
      showToast('تعذر البدء', result.message || 'فشل إطلاق الحملة.', 'error');
    }
  } catch (err) {
    showToast('خطأ بالخادم', 'تعذر إطلاق الحملة البريدية من خادم الويب.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function pauseCampaign() {
  try {
    const res = await fetch('/api/campaign/pause', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('تم التعليق', result.message, 'info');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إرسال أمر التعليق للخادم.', 'error');
  }
}

async function resumeCampaign() {
  try {
    const res = await fetch('/api/campaign/resume', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('استئناف ناجح', result.message, 'success');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إرسال أمر الاستئناف للخادم.', 'error');
  }
}

async function stopCampaign() {
  if (!confirm('هل أنت متأكد من رغبتك في إلغاء وإيقاف هذه الحملة تماماً؟ لا يمكنك التراجع.')) return;
  try {
    const res = await fetch('/api/campaign/stop', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('تم الإلغاء', result.message, 'warning');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إيقاف الحملة من الخادم.', 'error');
  }
}

// 7. Server-Sent Events (SSE) Real-time listener
function connectStatusSSE() {
  if (sseSource) {
    sseSource.close();
  }

  const pill = document.getElementById('connectionPill');
  const statusText = pill.querySelector('.status-text');

  sseSource = new EventSource('/api/campaign/status');

  sseSource.onopen = () => {
    pill.className = 'status-pill connected';
    statusText.innerText = 'متصل بالخادم فوريّاً';
  };

  sseSource.onerror = () => {
    pill.className = 'status-pill disconnected';
    statusText.innerText = 'غير متصل بالخادم';
  };

  sseSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    updateCampaignUI(data);
  };
}

// 8. Update Campaign Progress UI Real-time
function updateCampaignUI(data) {
  const statusLabel = document.getElementById('campaignStatusLabel');
  const controls = document.getElementById('campaignControls');
  const btnPause = document.getElementById('btnPauseCampaign');
  const btnResume = document.getElementById('btnResumeCampaign');

  // Stats
  document.getElementById('statTotal').innerText = data.total;
  document.getElementById('statSuccess').innerText = data.successCount;
  document.getElementById('statFail').innerText = data.failureCount;

  // Percentage Calculations
  const percentage = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
  document.getElementById('statPercentage').innerText = `${percentage}%`;

  // Update progress bar
  document.getElementById('campaignProgressBar').style.width = `${percentage}%`;
  document.getElementById('campaignProgressBarGlow').style.width = `${percentage}%`;

  // UI elements handling active campaign state
  if (data.active) {
    controls.classList.remove('hide');
    
    if (data.paused) {
      statusLabel.className = 'campaign-status-label paused';
      statusLabel.innerText = 'الحالة: معلق مؤقتاً';
      btnPause.classList.add('hide');
      btnResume.classList.remove('hide');
    } else {
      statusLabel.className = 'campaign-status-label running';
      statusLabel.innerText = 'الحالة: جاري الإرسال المباشر';
      btnPause.classList.remove('hide');
      btnResume.classList.add('hide');
    }
  } else {
    controls.classList.add('hide');
    statusLabel.className = 'campaign-status-label';
    statusLabel.innerText = 'الحالة: خامل';
  }

  // Update Terminal Logs
  if (data.logs && data.logs.length > 0) {
    const terminal = document.getElementById('terminalLogsBody');
    terminal.innerHTML = '';

    data.logs.forEach(log => {
      const line = document.createElement('div');
      line.className = `log-line ${log.status}`;
      
      let msg = '';
      if (log.status === 'success') {
        msg = `✅ [SUCCESS] Email sent successfully to ${log.recipientName} <${log.email}>`;
      } else if (log.status === 'failed') {
        msg = `❌ [FAILED] Error sending to ${log.recipientName} <${log.email}> - Error: ${log.error}`;
      } else if (log.status === 'info') {
        msg = `ℹ️ [SYSTEM] ${log.error}`;
      } else if (log.status === 'completed') {
        msg = `🎉 [COMPLETED] ${log.error}`;
      }

      line.innerHTML = `
        <span class="log-time">[${log.time}]</span>
        <span class="log-msg">${msg}</span>
      `;
      terminal.appendChild(line);
    });

    // Auto scroll to bottom
    terminal.scrollTop = terminal.scrollHeight;
  }
}
