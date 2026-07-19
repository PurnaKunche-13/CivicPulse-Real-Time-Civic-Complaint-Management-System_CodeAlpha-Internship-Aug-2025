require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'supersecretkey123';


// ================================
// Trust Render Proxy (HTTPS)
// ================================
app.set('trust proxy', 1);


// ================================
// View Engine
// ================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// ================================
// Static Files
// ================================
app.use(express.static(path.join(__dirname, 'public')));

app.use(
    '/uploads',
    express.static(path.join(__dirname, 'public', 'uploads'))
);


// ================================
// Body Parser
// ================================
app.use(bodyParser.urlencoded({ 
    extended: true 
}));

app.use(bodyParser.json());


// ================================
// Session
// ================================
app.use(
    session({
        secret: SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax'
        }
    })
);


// ================================
// Routes
// ================================
const indexRouter = require('./routes/index');

app.use('/', indexRouter);


// ================================
// Health Check (Render)
// ================================
app.get('/health', (req, res) => {
    res.status(200).json({
        status: "Server running",
        time: new Date()
    });
});


// ================================
// Start Server
// ================================
const server = app.listen(PORT, '0.0.0.0', () => {

    console.log(
        `Server running on port ${PORT}`
    );

});


// ================================
// Error Handling
// ================================
server.on('error', (err) => {

    if (err.code === 'EADDRINUSE') {

        console.error(
            `Port ${PORT} already in use`
        );

        process.exit(1);

    }

    console.error(err);

});