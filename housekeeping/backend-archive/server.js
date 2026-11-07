const express = require("express");
const cors = require("cors");
require("dotenv").config();
const cookieParser = require("cookie-parser");
const { fetchCurrentUser, createSessionCookie, createCSRF } = require("./apiFunctions");
const { requireAuth } = require("./middleware");


const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// CORS configuration allowing communication with Next.js frontend at localhost:3000
app.use(cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use((req, res, next) => {
    console.log(`${req.method} request at ${req.path} with status ${res.statusCode} and message ${res.message}`);
    next();
})


// async function verifyToken(req, res, next) {
//     try {
//         const authHeader = req.headers.authorization;
//     ]

//     }
//     catch(error) {
//         console.log("Token authentication failed: ", error);
//     }
// }
// app.post('/api/signup', async (req, res) => {

// }
/** test api to demonstrate the functionality of the express.js server */
app.get('/api/', (req, res) => {
    console.log("Hello from the backend!");
    res.send("Hello from the backend!");
});

/** API endpoint to verify the current user's authentication token and retrieve their information 
 * req should contain a valid Firebase ID token in the authorization field of the header.
 * Specifically, the header should be in the format: Authorization: Bearer <Firebase ID Token>
 * The endpoint will verify the token, and if valid, it will return the user's email and uid. If the token is invalid or missing, it will return an appropriate error message.
*/
app.get('/api/createCSRFToken', createCSRF);
app.get('/api/getCurrentUser', fetchCurrentUser);

/** api/session/login should  */
app.post('/api/session/login', createSessionCookie);
app.get('/api/dashboard', requireAuth, (req, res) => {
    //getDocuments
    res.json({ message: `Welcome ${req.user.email} to the dashboard!`});
});
app.post('/api/sessionLogout', clearCookie);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});




/** API FUNCTIONS
 * 
 */