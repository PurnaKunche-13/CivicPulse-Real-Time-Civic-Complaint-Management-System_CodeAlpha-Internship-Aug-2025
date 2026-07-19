const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { OpenAI } = require('openai');
const supabase = require('../lib/supabase');
const { createClient } = require('@supabase/supabase-js');
const getAuthClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});

// Multer setup for image uploads
const uploadDir = path.join(__dirname, '../public/uploads/');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- Telegram Helper ---
async function sendTelegramMessage(chatId, message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken || botToken === 'your_telegram_bot_token_here' || !chatId) {
        console.log('[Telegram] Skipped (no bot token or chat ID configured)');
        return;
    }
    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        const data = await response.json();
        if (data.ok) {
            console.log(`[Telegram] Message sent to chat ${chatId}`);
        } else {
            console.error('[Telegram] Error:', data.description);
        }
    } catch (err) {
        console.error('[Telegram] Failed to send message:', err.message);
    }
}

function getBaseUrl(req) {
    return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function formatUser(user) {
    if (!user) return null;

    return {
        ...user,
        _id: user.id,
        username: user.username || user.name || user.email || 'User',
        telegramChatId: user.telegram_chat_id || user.telegramChatId || null
    };
}

function formatProblem(problem) {
    if (!problem) return null;

    const postedBy = Array.isArray(problem.postedBy) ? problem.postedBy[0] : problem.postedBy;

    return {
        ...problem,
        _id: problem.id,
        imagePath: problem.image_path || problem.imagePath,
        postedBy: formatUser(postedBy),
        createdAt: problem.created_at ? new Date(problem.created_at) : new Date(),
        processingAt: problem.processing_at ? new Date(problem.processing_at) : null,
        completedAt: problem.completed_at ? new Date(problem.completed_at) : null
    };
}

async function getCurrentUser(req) {
    if (!req.session.userId) return null;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.session.userId)
        .single();

    if (error) {
        console.error('[Supabase] Failed to load user:', error.message);
        return formatUser(req.session.user);
    }

    return formatUser(data);
}

async function findOrCreateSupabaseUser(authUser) {
    const email = authUser.email;
    const username = authUser.user_metadata?.full_name || authUser.user_metadata?.name || email;

    const { data: existingUser, error: findError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

    if (findError) throw findError;
    if (existingUser) return formatUser(existingUser);

    const { data: createdUser, error: createError } = await supabase
        .from('users')
        .insert({
            id: authUser.id,
            username,
            email,
            avatar_url: authUser.user_metadata?.avatar_url || null
        })
        .select()
        .single();

    if (createError) throw createError;
    return formatUser(createdUser);
}

// Middleware to check authentication
const requireUserLogin = (req, res, next) => {
    if (req.session.userId) next();
    else res.redirect('/user-login');
};

const requireAdminLogin = (req, res, next) => {
    if (req.session.adminId) next();
    else res.redirect('/admin-login');
};

// --- Landing Page ---
router.get('/', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/user-dashboard');
    }
    if (req.session.adminId) {
        return res.redirect('/admin-dashboard');
    }
    res.render('index');
});

// --- User Routes ---
router.get('/user-register', (req, res) => {
    res.redirect('/user-login');
});

router.post('/user-register', async (req, res) => {
    res.redirect('/user-login');
});

router.get('/user-login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/user-dashboard');
    }
    res.render('user-login', { error: req.query.error || null });
});

router.get('/auth/google', async (req, res) => {
    const authClient = getAuthClient();
    const { data, error } = await authClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${getBaseUrl(req)}/auth/callback`
        }
    });

    if (error) {
        console.error('[Supabase] Google OAuth start failed:', error.message);
        return res.render('user-login', { error: 'Unable to start Google login. Check Supabase OAuth settings.' });
    }

    res.redirect(data.url);
});

router.get('/auth/callback', async (req, res) => {
    try {
        const { code, error: oauthError, error_description } = req.query;
        
        if (oauthError) {
            console.error('[Supabase] OAuth Callback Error:', oauthError, error_description);
            return res.redirect(`/user-login?error=${encodeURIComponent(error_description || oauthError)}`);
        }
        
        if (code) {
            const authClient = getAuthClient();
            const { data, error } = await authClient.auth.exchangeCodeForSession(code);
            if (error) throw error;

            const user = await findOrCreateSupabaseUser(data.user);
            req.session.userId = user.id;
            req.session.user = user;
            return req.session.save((saveErr) => {
                if (saveErr) {
                    console.error('[Session] Failed to save user login:', saveErr.message);
                    return res.render('user-login', { error: 'Login session could not be saved. Please try again.' });
                }
                res.redirect('/user-dashboard');
            });
        }

        // Render client-side page to parse the hash fragment tokens (Implicit flow)
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Authenticating...</title>
                <style>
                    body {
                        background-color: #0f172a;
                        color: #f8fafc;
                        font-family: 'Inter', sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .loader {
                        border: 4px solid #1e293b;
                        border-top: 4px solid #6366f1;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div style="text-align: center;">
                    <div class="loader" style="margin: 0 auto 1.5rem auto;"></div>
                    <p>Completing login, please wait...</p>
                </div>
                <script>
                    const hash = window.location.hash.substring(1);
                    const params = new URLSearchParams(hash);
                    const accessToken = params.get('access_token');
                    const refreshToken = params.get('refresh_token');
                    
                    if (accessToken) {
                        fetch('/auth/callback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if (data.success) {
                                window.location.href = '/user-dashboard';
                            } else {
                                window.location.href = '/user-login?error=' + encodeURIComponent(data.error || 'Failed to authenticate');
                            }
                        })
                        .catch(err => {
                            window.location.href = '/user-login?error=Network+error+during+authentication';
                        });
                    } else {
                        window.location.href = '/user-login?error=No+authentication+token+received';
                    }
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('[Supabase] Google OAuth callback failed:', err.message);
        res.render('user-login', { error: 'Google login failed. Please try again.' });
    }
});

router.post('/auth/callback', async (req, res) => {
    try {
        const { access_token, refresh_token } = req.body;
        if (!access_token) {
            return res.status(400).json({ error: 'Access token is required.' });
        }

        const authClient = getAuthClient();
        const { data, error } = await authClient.auth.setSession({
            access_token,
            refresh_token: refresh_token || ''
        });
        if (error) throw error;

        const user = await findOrCreateSupabaseUser(data.user);
        req.session.userId = user.id;
        req.session.user = user;
        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('[Session] Failed to save POST session:', saveErr.message);
                return res.status(500).json({ error: 'Failed to initialize session.' });
            }
            res.json({ success: true });
        });
    } catch (err) {
        console.error('[Supabase] POST auth/callback failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/auth/demo', async (req, res) => {
    try {
        const demoEmail = 'demo@civicpulse.org';
        const demoPassword = 'demopassword123';

        const authClient = getAuthClient();

        // 1. Try to sign in with password
        let { data, error } = await authClient.auth.signInWithPassword({
            email: demoEmail,
            password: demoPassword
        });

        // 2. If user doesn't exist, create it via admin API
        if (error && (error.message.includes('Invalid login credentials') || error.status === 400)) {
            console.log('[Demo Login] User not found, creating demo user in Supabase Auth...');
            const { data: newUser, error: createError } = await authClient.auth.admin.createUser({
                email: demoEmail,
                password: demoPassword,
                email_confirm: true,
                user_metadata: { full_name: 'Demo Citizen' }
            });
            if (createError) throw createError;

            // Try signing in again
            const loginRes = await authClient.auth.signInWithPassword({
                email: demoEmail,
                password: demoPassword
            });
            if (loginRes.error) throw loginRes.error;
            data = loginRes.data;
        } else if (error) {
            throw error;
        }

        // 3. Find or create in public.users (using clean global supabase client)
        const user = await findOrCreateSupabaseUser(data.user);

        // 4. Set session
        req.session.userId = user.id;
        req.session.user = user;
        req.session.save((saveErr) => {
            if (saveErr) {
                console.error('[Session] Failed to save demo session:', saveErr.message);
                return res.redirect('/user-login?error=Session+save+failed');
            }
            res.redirect('/user-dashboard');
        });
    } catch (err) {
        console.error('[Demo Login] Error:', err.message);
        res.redirect(`/user-login?error=${encodeURIComponent('Demo login failed: ' + err.message)}`);
    }
});

router.get('/user-logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

router.get('/user-dashboard', requireUserLogin, async (req, res) => {
    const user = await getCurrentUser(req);
    const { data, error } = await supabase
        .from('problems')
        .select('*')
        .eq('posted_by', req.session.userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[Supabase] Failed to load user problems:', error.message);
        return res.status(500).send('Error loading problems');
    }

    const problems = (data || []).map(problem => formatProblem({ ...problem, postedBy: user }));
    res.render('user-dashboard', { problems, success: req.query.success, user });
});

router.get('/problem/:id', requireUserLogin, async (req, res) => {
    try {
        const user = await getCurrentUser(req);
        const { data, error } = await supabase
            .from('problems')
            .select('*, postedBy:users(*)')
            .eq('id', req.params.id)
            .eq('posted_by', req.session.userId)
            .single();

        if (error) throw error;
        const problem = formatProblem(data);
        if (!problem) return res.status(404).send('Problem not found');
        res.render('user-view-problem', { problem, user });
    } catch (err) {
        console.error('[Supabase] Failed to load problem:', err.message);
        res.status(500).send('Error loading problem');
    }
});

router.get('/post-problem', requireUserLogin, async (req, res) => {
    const user = await getCurrentUser(req);
    res.render('post-problem', { user });
});

router.post('/post-problem', requireUserLogin, upload.single('image'), async (req, res) => {
    try {
        const { name: manualName, description: manualDescription, location } = req.body;

        if (!req.file) {
            return res.status(400).send('An image is required to post a problem.');
        }

        const imagePath = `/uploads/${req.file.filename}`;
        const finalName = manualName || 'Reported Issue';
        const finalDescription = manualDescription || 'Description unavailable';

        const { error } = await supabase.from('problems').insert({
            name: finalName,
            description: finalDescription,
            location,
            image_path: imagePath,
            posted_by: req.session.userId,
            status: 'pending'
        });

        if (error) throw error;
        res.redirect('/user-dashboard?success=1');
    } catch (err) {
        console.error('Error creating problem:', err);
        res.status(500).send('Error creating problem: ' + err.message);
    }
});

router.post('/api/generate-description', requireUserLogin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'An image is required to generate a description.' });
        }

        const localImagePath = req.file.path;
        const imageBase64 = fs.readFileSync(localImagePath).toString('base64');

        const prompt = `Analyze this image of a public problem (like a pothole, broken street light, trash, etc). Provide two things separated by a pipe character (|):
1. A very short title (max 5 words)
2. A short description (exactly exactly 20 words or less).
Format: Title | Description.`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${req.file.mimetype};base64,${imageBase64}` } }
                    ]
                }
            ],
            max_tokens: 150
        });

        const text = response.choices[0].message.content || 'Unknown Problem | Need more details';
        const parts = text.split('|').map(s => s.trim());

        res.json({
            name: parts[0] ? parts[0].replace(/\*/g, '').trim() : 'Reported Issue',
            description: parts[1] ? parts[1].replace(/\*/g, '').trim() : 'Description unavailable.'
        });

        try { fs.unlinkSync(localImagePath); } catch (e) { }
    } catch (err) {
        console.error('OpenAI Generation Error Details:', err);
        const errorMessage = err.response?.data?.error?.message || err.message || 'Unknown error';
        res.status(500).json({ error: `OpenAI Error: ${errorMessage}. Please check your key and quota.` });
    }
});

// --- Admin Routes ---
router.get('/admin-login', (req, res) => {
    if (req.session.adminId) {
        return res.redirect('/admin-dashboard');
    }
    res.render('admin-login', { error: null });
});

router.post('/admin-login', async (req, res) => {
    const { username, password } = req.body;

    const { data: admin, error } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username)
        .maybeSingle();

    if (!error && admin && admin.password === password) {
        req.session.adminId = admin.id;
        res.redirect('/admin-dashboard');
    } else {
        res.render('admin-login', { error: 'Invalid admin credentials' });
    }
});

router.get('/admin-logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

router.get('/admin-dashboard', requireAdminLogin, async (req, res) => {
    const { status, date, sortBy, order, location } = req.query;
    const allowedSortColumns = {
        createdAt: 'created_at',
        status: 'status'
    };

    let query = supabase.from('problems').select('*, postedBy:users(*)');

    if (status && status !== 'all') {
        query = query.eq('status', status);
    }

    if (date) {
        const selectedDate = new Date(date);
        const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
        query = query.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
    }

    if (location && location.trim() !== '') {
        query = query.ilike('location', `%${location.trim()}%`);
    }

    const sortColumn = allowedSortColumns[sortBy] || 'created_at';
    query = query.order(sortColumn, { ascending: order === 'asc' });

    const { data, error } = await query;
    if (error) {
        console.error('[Supabase] Failed to load admin dashboard:', error.message);
        return res.status(500).send('Error loading admin dashboard');
    }

    const problems = (data || []).map(formatProblem);
    res.render('admin-dashboard', {
        problems,
        filters: { status, date, sortBy, order, location }
    });
});

router.get('/admin/problem/:id', requireAdminLogin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('problems')
            .select('*, postedBy:users(*)')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        const problem = formatProblem(data);
        if (!problem) return res.status(404).send('Problem not found');
        res.render('admin-view-problem', { problem });
    } catch (err) {
        console.error('[Supabase] Failed to load admin problem:', err.message);
        res.status(500).send('Error loading problem');
    }
});

router.post('/update-status/:id', requireAdminLogin, async (req, res) => {
    const { status } = req.body;
    const updateData = { status };

    if (status === 'processing') {
        updateData.processing_at = new Date().toISOString();
    } else if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('problems')
        .update(updateData)
        .eq('id', req.params.id)
        .select('*, postedBy:users(*)')
        .single();

    if (error) {
        console.error('[Supabase] Failed to update status:', error.message);
        return res.status(500).send('Error updating problem status');
    }

    const problem = formatProblem(data);

    if (problem && problem.postedBy && problem.postedBy.telegramChatId) {
        const statusText = status === 'processing' ? 'Processing' : 'Completed';
        const message = `<b>Problem Status Updated</b>\n\n` +
            `<b>Problem:</b> ${problem.name}\n` +
            `<b>New Status:</b> ${statusText}\n` +
            `<b>Updated:</b> ${new Date().toLocaleDateString()}\n\n` +
            'View your problem on CivicPulse for more details.';

        await sendTelegramMessage(problem.postedBy.telegramChatId, message);
    }

    if (req.query.redirect === 'view') {
        res.redirect(`/admin/problem/${req.params.id}`);
    } else {
        res.redirect('/admin-dashboard');
    }
});

module.exports = router;

