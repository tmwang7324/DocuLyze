
const crypto = require("crypto");
const adminAuth = require("./admin").adminAuth;

async function fetchCurrentUser(req, res) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Auth header either does not exist or does not start with Bearer." });
        }
        const authToken = authHeader.split(" ")[1];
        const decodedToken = await adminAuth.verifyIdToken(authToken);
        const uid = decodedToken.uid;
        const userRecord = await adminAuth.getUser(uid);
    
        res.json({ email: userRecord.email, uid: userRecord.uid });
    } catch (error) {
        console.log("Error fetching current user: ", error);
        res.status(500).json({ error: "Internal server error" });
    }
}

async function createSessionCookie(req, res) {
    // Bug fix: declare outside try so they remain in scope for createSessionCookie call below
    let idToken;
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days in milliseconds

    try {
        // Bug fix: req.body.idToken is the token string directly — not a nested object
        idToken = req.body.idToken;
        if (!idToken) {
            return res.status(400).json({ error: "Request body must contain an idToken." });
        }
        const csrfToken = req.body.csrfToken;
        if (!csrfToken || csrfToken !== req.cookies.csrfToken) {
            return res.status(401).json({ error: "Request body must contain a valid CSRF token." });
        }
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;
    } catch (error) {
        console.log("Error verifying ID token: ", error);
        return res.status(401).json({ error: "Invalid Firebase ID Token."});
    }

    adminAuth.createSessionCookie(idToken, { expiresIn }).then((sessionCookie) => {
        options= {
            httpOnly: true,
            secure: false, // Set to true in production when using HTTPS
            sameSite: "lax",
            signed: true,
            maxAge: expiresIn
            
        }
        res.cookie("session", sessionCookie, options);
        return res.json({
            message: `Session cookie created successfully ${sessionCookie}`,
            sessionCookie: sessionCookie
        });
        //console.log("Session cookie created successfully: ", sessionCookie);
    }).catch((error) => {
        console.log("Error creating session cookie: ", error);
        return res.status(401).json({ error: "Invalid Firebase ID Token."});
    });
}

async function createCSRF(req, res) {
    const csrfToken = crypto.randomBytes(32).toString("hex");

    res.cookie("csrfToken", csrfToken, {
        httpOnly: false,
        secure: false, // Set to true in production when using HTTPS
        sameSite: "lax",
        path: "/",
    });

    res.json({ csrfToken });

}

async function clearCookie(req, res) {
    const sessionCookie = req.cookies.refresh || '';
    res.clearCookie("refresh");
    try {
        adminAuth.verifySessionCookie(sessionCookie, true).then((decodedClaims) => {
            adminAuth.revokeRefreshTokens(decodedClaims.sub);
        }).then(() => {
            res.redirect('/login');
        });
    } catch (error) {
        console.log("Error verifying session cookie: ", error);
    }
    res.json({ message: "Cookies cleared successfully" });
}

module.exports = {
    fetchCurrentUser,
    createSessionCookie,
    createCSRF

}


