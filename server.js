require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

// =======================
// View Engine
// =======================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// =======================
// Middleware
// =======================
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET || "mysecret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // true only if using HTTPS
            maxAge: 1000 * 60 * 60 * 24 // 1 day
        }
    })
);

// =======================
// Routes
// =======================
const indexRouter = require("./routes/index");

app.use("/", indexRouter);

// =======================
// 404 Page
// =======================
app.use((req, res) => {
    res.status(404).send("404 - Page Not Found");
});

// =======================
// Error Handler
// =======================
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (res.headersSent) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).send('Image must be 5 MB or smaller.');
    if (err instanceof require('multer').MulterError || err.status === 400) return res.status(400).send(err.message);
    res.status(500).send("Internal Server Error");
});

// =======================
// Start Server
// =======================
if (require.main === module) app.listen(PORT, () => {
    console.log("================================");
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log("================================");
});
module.exports = app;
