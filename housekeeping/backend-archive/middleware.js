const adminAuth = require("./admin").adminAuth;

async function requireAuth(req, res, next) {
    const sessionCookie = req.cookies.session;
    if (!sessionCookie) {
        return res.status(401).json({ error: "Unauthorized: No session cookie found." });
    }

    try {
        const decodedToken = await adminAuth.verifySessionCookie(sessionCookie, true /** checkRevoked */);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.log("Error verifying session cookie: ", error);
        return res.status(401).json({ error: "Unauthorized: Invalid session cookie." });
    }


}


module.exports = {
    requireAuth
}