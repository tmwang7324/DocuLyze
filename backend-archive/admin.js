/** Firebase Admin SDK initialization
 * Note: The serviceAccountKey.json file should be securely stored and not committed to version control. It contains sensitive information about your Firebase project. Make sure to add it to your .gitignore file and handle it with care.
 */
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");


if (admin.apps.length === 0) {
    admin.initializeApp({
        // serviceAccount is the JSON object containing the service account credentials. It should be securely stored and not committed to version control.
        credential: admin.credential.cert(serviceAccount),
        //,databaseURL: "https://doculyze-846b1-default-rtdb.firebaseio.com"
    });
} else {
    admin.app(); // if already initialized, use that one
}
const adminAuth = admin.auth();

module.exports = {
    adminAuth
}