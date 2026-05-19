const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Data directory for persistence (useful for Render Persistent Disks)
const DATA_DIR = process.env.DATA_DIR || __dirname;

const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure Multer for CSV and attachment uploads
const upload = multer({ dest: uploadsDir });

// Path for storing config persistence
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'config.json');

// Copy default config to persistent dir if not present
if (DATA_DIR !== __dirname && !fs.existsSync(CONFIG_FILE) && fs.existsSync(DEFAULT_CONFIG_FILE)) {
  try {
    fs.copyFileSync(DEFAULT_CONFIG_FILE, CONFIG_FILE);
    console.log(`Copied default config.json to persistent directory: ${CONFIG_FILE}`);
  } catch (err) {
    console.error('Failed to copy default config.json:', err);
  }
}

// Helper to load SMTP configuration
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (!data.accounts) {
        data.accounts = [];
      }
      return data;
    } catch (err) {
      console.error('Error reading config file:', err);
    }
  }
  return { accounts: [] };
}

// Helper to save SMTP configuration
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving config file:', err);
    return false;
  }
}

// Active Campaign State
let campaignState = {
  active: false,
  paused: false,
  total: 0,
  current: 0,
  successCount: 0,
  failureCount: 0,
  recipients: [],
  subject: '',
  htmlTemplate: '',
  delay: 2000,
  logs: [], // Array of { email, recipientName, accountUser, status, time, error }
  index: 0
};

// SSE Active Clients
let sseClients = [];

// Broadcast campaign status to all connected SSE clients
function broadcastStatus() {
  const data = JSON.stringify({
    active: campaignState.active,
    paused: campaignState.paused,
    total: campaignState.total,
    current: campaignState.current,
    successCount: campaignState.successCount,
    failureCount: campaignState.failureCount,
    index: campaignState.index,
    logs: campaignState.logs.slice(-100) // send last 100 logs to reduce payload size
  });

  sseClients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// Helper function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Replace custom placeholders like {{name}}, {{email}}, or any other {{key}} dynamically
function parseTemplate(template, recipient) {
  let content = template;
  for (const [key, value] of Object.entries(recipient)) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    content = content.replace(placeholder, value || '');
  }
  return content;
}

// Helper to clean up uploaded attachment temp files
function cleanUploadedFiles(files) {
  if (files && Array.isArray(files)) {
    files.forEach(file => {
      if (fs.existsSync(file.path)) {
        fs.unlink(file.path, (err) => {
          if (err) console.error('Error deleting temp upload file:', err);
        });
      }
    });
  }
}

// Global Campaign Runner Loop (Round-Robin among Active SMTP Accounts)
async function runCampaign() {
  try {
    const config = loadConfig();
    const activeAccounts = (config.accounts || []).filter(acc => acc.isActive);
    
    if (activeAccounts.length === 0) {
      campaignState.active = false;
      campaignState.logs.push({
        email: '-',
        recipientName: 'النظام',
        accountUser: 'النظام',
        status: 'failed',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: 'فشل البدء: لا توجد حسابات SMTP نشطة!'
      });
      broadcastStatus();
      return;
    }

    while (campaignState.active && campaignState.index < campaignState.total) {
      if (campaignState.paused) {
        await sleep(500);
        continue;
      }

      if (!campaignState.active) break;

      const recipient = campaignState.recipients[campaignState.index];
      // Select account round-robin style
      const account = activeAccounts[campaignState.index % activeAccounts.length];

      let actualPass = account.pass || '';
      if (actualPass && account.host.toLowerCase().includes('gmail')) {
        actualPass = actualPass.replace(/\s/g, '');
      }

      const transporter = nodemailer.createTransport({
        host: account.host,
        port: parseInt(account.port),
        secure: account.secure === true || account.port == 465,
        auth: {
          user: account.user,
          pass: actualPass
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      const personalizedSubject = parseTemplate(campaignState.subject, recipient);
      const personalizedHtml = parseTemplate(campaignState.htmlTemplate, recipient);

      const attachments = (campaignState.attachments || []).map(file => {
        let safeName = file.originalname;
        try {
          safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        } catch (e) {}
        return {
          filename: safeName,
          path: file.path,
          cid: safeName
        };
      });

      const mailOptions = {
        from: `"${account.fromName || 'نظام الإرسال'}" <${account.fromEmail || account.user}>`,
        to: recipient.email,
        subject: personalizedSubject,
        html: personalizedHtml,
        attachments: attachments
      };

      try {
        await transporter.sendMail(mailOptions);
        
        campaignState.successCount++;
        campaignState.current++;
        campaignState.logs.push({
          email: recipient.email,
          recipientName: recipient.name || 'بدون اسم',
          accountUser: account.user,
          status: 'success',
          time: new Date().toLocaleTimeString('ar-EG'),
          error: null
        });
      } catch (err) {
        console.error(`Error sending email to ${recipient.email} via ${account.user}:`, err.message);
        
        campaignState.failureCount++;
        campaignState.current++;
        campaignState.logs.push({
          email: recipient.email || 'غير معروف',
          recipientName: recipient.name || 'بدون اسم',
          accountUser: account.user,
          status: 'failed',
          time: new Date().toLocaleTimeString('ar-EG'),
          error: err.message || 'فشل غير معروف'
        });
      }

      campaignState.index++;
      broadcastStatus();

      if (campaignState.active && campaignState.index < campaignState.total) {
        await sleep(campaignState.delay);
      }
    }

    if (campaignState.index >= campaignState.total && campaignState.active) {
      campaignState.active = false;
      campaignState.logs.push({
        email: '-',
        recipientName: 'النظام',
        accountUser: 'النظام',
        status: 'completed',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: 'اكتملت الحملة البريدية العامة بنجاح!'
      });
      broadcastStatus();
    }
  } catch (loopError) {
    console.error('Error in campaign loop:', loopError);
  } finally {
    cleanUploadedFiles(campaignState.attachments);
  }
}

// Account-Specific Campaign Runner Loop
async function runAccountCampaign(account, globalDelay) {
  let index = 0;
  const recipients = account.recipients || [];
  const total = recipients.length;

  while (campaignState.active && index < total) {
    if (campaignState.paused) {
      await sleep(500);
      continue;
    }

    if (!campaignState.active) break;

    const recipient = recipients[index];

    let actualPass = account.pass || '';
    if (actualPass && account.host.toLowerCase().includes('gmail')) {
      actualPass = actualPass.replace(/\s/g, '');
    }

    const transporter = nodemailer.createTransport({
      host: account.host,
      port: parseInt(account.port),
      secure: account.secure === true || account.port == 465,
      auth: {
        user: account.user,
        pass: actualPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const personalizedSubject = parseTemplate(account.customSubject || 'بدون موضوع', recipient);
    let personalizedHtml = parseTemplate(account.customHtml || '', recipient);

    // Format plain text template to clean HTML with correct RTL styling
    const isHtml = /<[a-z][\s\S]*>/i.test(personalizedHtml);
    if (!isHtml) {
      personalizedHtml = `<div style="font-family: sans-serif; font-size: 15px; direction: rtl; text-align: right; line-height: 1.6; color: #333333;">${personalizedHtml.replace(/\n/g, '<br>')}</div>`;
    }

    const attachments = [];
    if (account.attachment && account.attachment.path) {
      const attPath = path.join(DATA_DIR, account.attachment.path);
      if (fs.existsSync(attPath)) {
        let safeName = account.attachment.filename;
        try {
          safeName = Buffer.from(account.attachment.filename, 'latin1').toString('utf8');
        } catch (e) {}

        attachments.push({
          filename: safeName,
          path: attPath,
          cid: 'attachment_image'
        });

        // Auto-embed image at bottom if it's an image file and not already referenced via CID in template
        const isImg = /\.(png|jpe?g|gif|webp|bmp)$/i.test(safeName);
        if (isImg && !personalizedHtml.includes('cid:attachment_image')) {
          personalizedHtml += `<br><br><div style="text-align: right; margin-top: 15px;"><img src="cid:attachment_image" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);"></div>`;
        }
      }
    }

    const mailOptions = {
      from: `"${account.fromName || 'نظام الإرسال'}" <${account.fromEmail || account.user}>`,
      to: recipient.email,
      subject: personalizedSubject,
      html: personalizedHtml,
      attachments: attachments
    };

    try {
      await transporter.sendMail(mailOptions);
      
      campaignState.successCount++;
      campaignState.current++;
      campaignState.logs.push({
        email: recipient.email,
        recipientName: recipient.name || 'بدون اسم',
        accountUser: account.user,
        status: 'success',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: null
      });
    } catch (err) {
      console.error(`Error sending email from ${account.user} to ${recipient.email}:`, err.message);
      
      campaignState.failureCount++;
      campaignState.current++;
      campaignState.logs.push({
        email: recipient.email || 'غير معروف',
        recipientName: recipient.name || 'بدون اسم',
        accountUser: account.user,
        status: 'failed',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: err.message || 'فشل غير معروف'
      });
    }

    broadcastStatus();
    index++;

    if (campaignState.active && index < total) {
      await sleep(globalDelay);
    }
  }
}

// Multi-Account Campaigns Aggregator
async function runMultiCampaign(activeAccounts, globalDelay) {
  try {
    const promises = activeAccounts.map(account => runAccountCampaign(account, globalDelay));
    await Promise.all(promises);

    if (campaignState.active) {
      campaignState.active = false;
      campaignState.logs.push({
        email: '-',
        recipientName: 'النظام',
        accountUser: 'النظام',
        status: 'completed',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: 'اكتملت الحملات البريدية لكافة الحسابات بنجاح!'
      });
      broadcastStatus();
    }
  } catch (error) {
    console.error('Error in multi-campaign aggregator:', error);
  }
}

// --- API ROUTES ---

// 1. Get configuration (multiple accounts support)
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  const maskedAccounts = (config.accounts || []).map(acc => {
    const masked = { ...acc };
    if (masked.pass) {
      masked.pass = '••••••••••••••••';
      masked.hasPassword = true;
    } else {
      masked.hasPassword = false;
    }
    return masked;
  });
  res.json({ success: true, data: { accounts: maskedAccounts } });
});

// 2. Save SMTP Account (Add or Update)
app.post('/api/config/save-account', (req, res) => {
  const { index, host, port, secure, user, pass, fromName, fromEmail, customSubject, customHtml, recipients, isActive } = req.body;
  const config = loadConfig();
  const accounts = config.accounts || [];

  const targetIdx = parseInt(index);
  let existingAccount = null;
  if (targetIdx >= 0 && targetIdx < accounts.length) {
    existingAccount = accounts[targetIdx];
  }

  let cleanPass = pass;
  if (pass === '••••••••••••••••' && existingAccount) {
    cleanPass = existingAccount.pass;
  } else if (cleanPass && host && host.toLowerCase().includes('gmail')) {
    cleanPass = cleanPass.replace(/\s/g, '');
  }

  let parsedRecipients = recipients;
  if (typeof recipients === 'string') {
    try {
      parsedRecipients = JSON.parse(recipients);
    } catch(e) {
      parsedRecipients = [];
    }
  }

  const accountData = {
    host: host || '',
    port: parseInt(port) || 587,
    secure: secure === true || secure === 'true',
    user: user || '',
    pass: cleanPass || '',
    fromName: fromName || '',
    fromEmail: fromEmail || user || '',
    customSubject: customSubject || '',
    customHtml: customHtml || '',
    recipients: Array.isArray(parsedRecipients) ? parsedRecipients : [],
    isActive: isActive === true || isActive === 'true',
    attachment: existingAccount ? existingAccount.attachment : null
  };

  if (targetIdx >= 0 && targetIdx < accounts.length) {
    accounts[targetIdx] = accountData;
  } else {
    accounts.push(accountData);
  }

  config.accounts = accounts;
  if (saveConfig(config)) {
    res.json({ success: true, message: 'تم حفظ إعدادات الحساب بنجاح!' });
  } else {
    res.status(500).json({ success: false, message: 'فشل حفظ الإعدادات.' });
  }
});

// 3. Delete SMTP Account
app.post('/api/config/delete-account', (req, res) => {
  const { index } = req.body;
  const config = loadConfig();
  const accounts = config.accounts || [];
  const idx = parseInt(index);

  if (idx >= 0 && idx < accounts.length) {
    const account = accounts[idx];
    if (account.attachment && account.attachment.path) {
      const filePath = path.join(DATA_DIR, account.attachment.path);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting attachment file:', err);
        });
      }
    }
    accounts.splice(idx, 1);
    config.accounts = accounts;
    if (saveConfig(config)) {
      return res.json({ success: true, message: 'تم حذف الحساب بنجاح!' });
    }
  }
  res.status(400).json({ success: false, message: 'رقم الحساب غير صالح للتنفيذ!' });
});

// 4. Upload Attachment for Specific Account
app.post('/api/config/upload-attachment', upload.single('attachment'), (req, res) => {
  const { index } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'لم يتم إرفاق أي ملف للرفع!' });
  }

  const config = loadConfig();
  const accounts = config.accounts || [];
  const idx = parseInt(index);

  if (idx >= 0 && idx < accounts.length) {
    const account = accounts[idx];
    if (account.attachment && account.attachment.path) {
      const oldPath = path.join(DATA_DIR, account.attachment.path);
      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, (err) => {
          if (err) console.error('Error deleting old attachment file:', err);
        });
      }
    }

    const relPath = path.relative(DATA_DIR, req.file.path);
    let safeFilename = req.file.originalname;
    try {
      safeFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch (e) {}

    account.attachment = {
      filename: safeFilename,
      path: relPath.replace(/\\/g, '/') // standard url-like slashes
    };

    accounts[idx] = account;
    config.accounts = accounts;

    if (saveConfig(config)) {
      return res.json({ success: true, message: 'تم حفظ وربط الصورة/الملف المرفق بالحساب بنجاح!', attachment: account.attachment });
    }
  }

  if (req.file && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }
  res.status(400).json({ success: false, message: 'فشل حفظ الملف المرفق.' });
});

// 5. Test SMTP connection for custom account parameters
app.post('/api/config/test-account', async (req, res) => {
  const { host, port, secure, user, pass, index } = req.body;
  const config = loadConfig();
  const accounts = config.accounts || [];
  
  let actualPass = pass;
  const idx = parseInt(index);
  if (pass === '••••••••••••••••' && idx >= 0 && idx < accounts.length) {
    actualPass = accounts[idx].pass;
  }

  if (actualPass && host && host.toLowerCase().includes('gmail')) {
    actualPass = actualPass.replace(/\s/g, '');
  }

  if (!host || !user || !actualPass) {
    return res.status(400).json({ success: false, message: 'الرجاء ملء جميع الحقول المطلوبة للتجربة (المضيف، اسم المستخدم، كلمة المرور)' });
  }

  const transporter = nodemailer.createTransport({
    host: host,
    port: parseInt(port) || 587,
    secure: secure === true || secure === 'true' || port == 465,
    auth: {
      user: user,
      pass: actualPass
    },
    tls: {
      rejectUnauthorized: false
    },
    timeout: 8000
  });

  try {
    await transporter.verify();
    res.json({ success: true, message: 'تم الاتصال بخادم SMTP بنجاح! الإعدادات صحيحة.' });
  } catch (err) {
    console.error('SMTP verification error:', err);
    res.json({ 
      success: false, 
      message: `فشل الاتصال: ${err.message || 'تأكد من صحة البيانات وتفعيل خيارات الأمان المناسبة.'}` 
    });
  }
});

// 6. Start active campaign
app.post('/api/campaign/start', upload.array('attachments'), (req, res) => {
  const { subject, htmlTemplate, delay } = req.body;
  let recipients = req.body.recipients;

  if (typeof recipients === 'string') {
    try {
      recipients = JSON.parse(recipients);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'قائمة المستلمين المرفقة غير صالحة!' });
    }
  }

  const config = loadConfig();
  const activeAccounts = (config.accounts || []).filter(acc => acc.isActive);

  if (activeAccounts.length === 0) {
    return res.status(400).json({ success: false, message: 'برجاء تفعيل وحفظ حساب SMTP نشط واحد على الأقل قبل بدء الحملة!' });
  }

  const isGlobalCampaign = recipients && Array.isArray(recipients) && recipients.length > 0;

  if (campaignState.active) {
    cleanUploadedFiles(req.files);
    return res.status(400).json({ success: false, message: 'هناك حملة بريدية نشطة بالفعل قيد الإرسال!' });
  }

  if (isGlobalCampaign) {
    if (!subject) {
      return res.status(400).json({ success: false, message: 'عنوان الرسالة مطلوب للحملة العامة!' });
    }
    if (!htmlTemplate) {
      return res.status(400).json({ success: false, message: 'محتوى الرسالة مطلوب للحملة العامة!' });
    }

    // Initialize campaign state
    campaignState = {
      active: true,
      paused: false,
      total: recipients.length,
      current: 0,
      successCount: 0,
      failureCount: 0,
      recipients: recipients,
      subject: subject,
      htmlTemplate: htmlTemplate,
      delay: parseInt(delay) || 2000,
      attachments: req.files || [],
      logs: [{
        email: '-',
        recipientName: 'النظام',
        accountUser: 'النظام',
        status: 'info',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: `بدء حملة بريدية عامة جديدة لعدد ${recipients.length} مستلم عبر ${activeAccounts.length} حسابات نشطة بالتناوب.`
      }],
      index: 0
    };

    runCampaign();
    res.json({ success: true, message: 'تم إطلاق الحملة البريدية العامة في الخلفية بنجاح!' });
  } else {
    // Multi-account campaign with account-specific recipients lists
    const totalRecipients = activeAccounts.reduce((sum, acc) => sum + (acc.recipients ? acc.recipients.length : 0), 0);

    if (totalRecipients === 0) {
      return res.status(400).json({ success: false, message: 'قوائم المستلمين فارغة! يرجى تحميل ملف CSV أو لصق جهات اتصال لكل حساب نشط تريد استخدامه.' });
    }

    campaignState = {
      active: true,
      paused: false,
      total: totalRecipients,
      current: 0,
      successCount: 0,
      failureCount: 0,
      recipients: [],
      subject: 'متعدد (حسابات مخصصة)',
      htmlTemplate: 'متعدد (حسابات مخصصة)',
      delay: parseInt(delay) || 2000,
      attachments: [],
      logs: [{
        email: '-',
        recipientName: 'النظام',
        accountUser: 'النظام',
        status: 'info',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: `بدء حملة بريدية مخصصة لكل حساب نشط. إجمالي المستلمين: ${totalRecipients} عبر ${activeAccounts.length} حسابات نشطة بالتوازي.`
      }],
      index: 0
    };

    runMultiCampaign(activeAccounts, parseInt(delay) || 2000);
    res.json({ success: true, message: 'تم إطلاق الحملات البريدية المخصصة للحسابات في الخلفية بنجاح!' });
  }
});

// 7. Pause campaign
app.post('/api/campaign/pause', (req, res) => {
  if (!campaignState.active) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة بريدية نشطة لتعليقها!' });
  }
  campaignState.paused = true;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    accountUser: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم تعليق الإرسال مؤقتاً لكافة الحملات.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم تعليق الإرسال مؤقتاً.' });
});

// 8. Resume campaign
app.post('/api/campaign/resume', (req, res) => {
  if (!campaignState.active || !campaignState.paused) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة معلقة لاستئنافها!' });
  }
  campaignState.paused = false;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    accountUser: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم استئناف الإرسال لكافة الحسابات.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم استئناف الإرسال بنجاح!' });
});

// 9. Stop campaign
app.post('/api/campaign/stop', (req, res) => {
  if (!campaignState.active) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة نشطة لإيقافها!' });
  }
  campaignState.active = false;
  campaignState.paused = false;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    accountUser: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم إلغاء وإيقاف جميع الحملات البريدية النشطة من قبل المستخدم.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم إيقاف وإلغاء الحملة البريدية بنجاح!' });
});

// 10. SSE Endpoint for status stream
app.get('/api/campaign/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Immediately send current status
  const data = JSON.stringify({
    active: campaignState.active,
    paused: campaignState.paused,
    total: campaignState.total,
    current: campaignState.current,
    successCount: campaignState.successCount,
    failureCount: campaignState.failureCount,
    index: campaignState.index,
    logs: campaignState.logs.slice(-100)
  });
  res.write(`data: ${data}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Fallback for SPA (if they navigate)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Bulk Email System Server is running successfully!`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});

