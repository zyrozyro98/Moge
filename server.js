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

// Configure Multer for CSV uploads (optional, since we also support direct pasting & JSON uploading)
const upload = multer({ dest: 'uploads/' });

// Path for storing config persistence
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Helper to load SMTP configuration
function loadConfig() {
  // 1. First, prioritize the local config.json file (user's saved settings in UI take absolute priority)
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading config file:', err);
    }
  }

  // 2. If no config.json exists, fallback to Environment Variables (perfect for secure Render/Railway cloud deployment)
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT == 465,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      fromName: process.env.SMTP_FROM_NAME || 'نظام الإرسال الجماعي',
      fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || ''
    };
  }

  // 3. Ultimate default fallback
  return {
    host: '',
    port: 587,
    secure: false, // true for 465, false for other ports
    user: '',
    pass: '',
    fromName: 'نظام الإرسال الجماعي',
    fromEmail: ''
  };
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
  logs: [], // Array of { email, recipientName, status, time, error }
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
  // Dynamic case-insensitive or exact replacement for all keys in recipient
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

// Background Campaign Runner Loop
async function runCampaign() {
  try {
    while (campaignState.active && campaignState.index < campaignState.total) {
      if (campaignState.paused) {
        await sleep(500);
        continue;
      }

      // Check active state again right before starting processing to catch instant stops
      if (!campaignState.active) break;

      const recipient = campaignState.recipients[campaignState.index];
      const config = loadConfig();

      if (!config.host || !config.user || !config.pass) {
        campaignState.active = false;
        campaignState.logs.push({
          email: recipient.email || 'غير معروف',
          recipientName: recipient.name || 'غير معروف',
          status: 'failed',
          time: new Date().toLocaleTimeString('ar-EG'),
          error: 'فشل الإرسال: إعدادات SMTP غير مكتملة'
        });
        broadcastStatus();
        break;
      }

      // Set up transporter
      let actualPass = config.pass || '';
      if (actualPass && config.host.toLowerCase().includes('gmail')) {
        actualPass = actualPass.replace(/\s/g, '');
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port),
        secure: config.secure === true || config.port == 465,
        auth: {
          user: config.user,
          pass: actualPass
        },
        tls: {
          rejectUnauthorized: false // Bypass SSL errors for local or self-signed servers if needed
        }
      });

      const personalizedSubject = parseTemplate(campaignState.subject, recipient);
      const personalizedHtml = parseTemplate(campaignState.htmlTemplate, recipient);

      const attachments = (campaignState.attachments || []).map(file => ({
        filename: file.originalname,
        path: file.path,
        cid: file.originalname // Sets Content-ID same as original filename to support inline images <img src="cid:image.png">
      }));

      const mailOptions = {
        from: `"${config.fromName}" <${config.fromEmail || config.user}>`,
        to: recipient.email,
        subject: personalizedSubject,
        html: personalizedHtml,
        attachments: attachments
      };

      try {
        await transporter.sendMail(mailOptions);
        
        // Success log
        campaignState.successCount++;
        campaignState.current++;
        campaignState.logs.push({
          email: recipient.email,
          recipientName: recipient.name || 'بدون اسم',
          status: 'success',
          time: new Date().toLocaleTimeString('ar-EG'),
          error: null
        });
      } catch (err) {
        console.error(`Error sending email to ${recipient.email}:`, err.message);
        
        // Failure log
        campaignState.failureCount++;
        campaignState.current++;
        campaignState.logs.push({
          email: recipient.email || 'غير معروف',
          recipientName: recipient.name || 'بدون اسم',
          status: 'failed',
          time: new Date().toLocaleTimeString('ar-EG'),
          error: err.message || 'فشل غير معروف'
        });
      }

      campaignState.index++;
      broadcastStatus();

      // Delay if there are more emails to send and campaign is still active
      if (campaignState.active && campaignState.index < campaignState.total) {
        await sleep(campaignState.delay);
      }
    }

    // Completed
    if (campaignState.index >= campaignState.total && campaignState.active) {
      campaignState.active = false;
      campaignState.logs.push({
        email: '-',
        recipientName: 'النظام',
        status: 'completed',
        time: new Date().toLocaleTimeString('ar-EG'),
        error: 'اكتملت الحملة البريدية بنجاح!'
      });
      broadcastStatus();
    }
  } catch (loopError) {
    console.error('Error in campaign loop:', loopError);
  } finally {
    // ALWAYS clean up attachments when exiting the campaign loop safely
    cleanUploadedFiles(campaignState.attachments);
  }
}

// --- API ROUTES ---

// 1. Get current configuration
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  // Don't send back the real password in plain text for security, or send it masked. 
  // For a developer/local dashboard, sending it masked or as a placeholder is neat.
  const maskedConfig = { ...config };
  if (maskedConfig.pass) {
    maskedConfig.pass = '••••••••••••••••';
    maskedConfig.hasPassword = true;
  } else {
    maskedConfig.hasPassword = false;
  }
  res.json({ success: true, data: maskedConfig });
});

// 2. Save SMTP configuration
app.post('/api/config', (req, res) => {
  const { host, port, secure, user, pass, fromName, fromEmail } = req.body;
  const currentConfig = loadConfig();
  
  let cleanPass = pass === '••••••••••••••••' ? currentConfig.pass : (pass || '');
  if (cleanPass && cleanPass !== '••••••••••••••••' && host && host.toLowerCase().includes('gmail')) {
    cleanPass = cleanPass.replace(/\s/g, '');
  }

  const newConfig = {
    host: host || '',
    port: parseInt(port) || 587,
    secure: secure === true || secure === 'true',
    user: user || '',
    pass: cleanPass,
    fromName: fromName || 'نظام الإرسال الجماعي',
    fromEmail: fromEmail || user || ''
  };

  if (saveConfig(newConfig)) {
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح!' });
  } else {
    res.status(500).json({ success: false, message: 'فشل حفظ الإعدادات.' });
  }
});

// 3. Test SMTP connection
app.post('/api/config/test', async (req, res) => {
  const { host, port, secure, user, pass } = req.body;
  const currentConfig = loadConfig();
  
  // Handle password mask
  let actualPass = pass === '••••••••••••••••' ? currentConfig.pass : pass;
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
    timeout: 8000 // 8 seconds timeout
  });

  try {
    await transporter.verify();
    res.json({ success: true, message: 'تم الاتصال بخادم SMTP بنجاح! الإعدادات صحيحة.' });
  } catch (err) {
    console.error('SMTP verification error:', err);
    res.json({ 
      success: false, 
      message: `فشل الاتصال: ${err.message || 'تأكد من صحة البيانات أو تفعيل خيار التطبيقات الأقل أماناً / كلمة مرور التطبيق (App Password)'}` 
    });
  }
});

// 4. Start active campaign
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

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, message: 'قائمة المستلمين فارغة أو غير صالحة!' });
  }
  if (!subject) {
    return res.status(400).json({ success: false, message: 'عنوان الرسالة مطلوب!' });
  }
  if (!htmlTemplate) {
    return res.status(400).json({ success: false, message: 'محتوى الرسالة مطلوب!' });
  }

  // Validate SMTP config exists first
  const config = loadConfig();
  if (!config.host || !config.user || !config.pass) {
    return res.status(400).json({ success: false, message: 'برجاء ضبط وحفظ إعدادات الـ SMTP أولاً قبل بدء الحملة!' });
  }

  if (campaignState.active) {
    // If a campaign is already active, we should delete newly uploaded files immediately!
    cleanUploadedFiles(req.files);
    return res.status(400).json({ success: false, message: 'هناك حملة بريدية نشطة بالفعل قيد الإرسال!' });
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
      status: 'info',
      time: new Date().toLocaleTimeString('ar-EG'),
      error: `بدء حملة بريدية جديدة لعدد ${recipients.length} مستلم.`
    }],
    index: 0
  };

  // Run campaign asynchronously in background
  runCampaign();

  res.json({ success: true, message: 'تم إطلاق الحملة البريدية في الخلفية بنجاح!' });
});

// 5. Pause campaign
app.post('/api/campaign/pause', (req, res) => {
  if (!campaignState.active) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة بريدية نشطة لتعليقها!' });
  }
  campaignState.paused = true;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم تعليق الإرسال مؤقتاً.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم تعليق الإرسال مؤقتاً.' });
});

// 6. Resume campaign
app.post('/api/campaign/resume', (req, res) => {
  if (!campaignState.active || !campaignState.paused) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة معلقة لاستئنافها!' });
  }
  campaignState.paused = false;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم استئناف الإرسال.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم استئناف الإرسال بنجاح!' });
});

// 7. Stop campaign
app.post('/api/campaign/stop', (req, res) => {
  if (!campaignState.active) {
    return res.status(400).json({ success: false, message: 'لا توجد حملة نشطة لإيقافها!' });
  }
  campaignState.active = false;
  campaignState.paused = false;
  campaignState.logs.push({
    email: '-',
    recipientName: 'النظام',
    status: 'info',
    time: new Date().toLocaleTimeString('ar-EG'),
    error: 'تم إلغاء وإيقاف الحملة البريدية من قبل المستخدم.'
  });
  broadcastStatus();
  res.json({ success: true, message: 'تم إيقاف وإلغاء الحملة البريدية بنجاح!' });
});

// 8. SSE Endpoint for status stream
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
