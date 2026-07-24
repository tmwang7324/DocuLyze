import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";

	// Your web app's Firebase configuration
		// For Firebase JS SDK v7.20.0 and later, measurementId is optional

let config = {
		apiKey: "AIzaSyD_kGfHwNg-IC8lMYEcpeA9JIwsvcyigp0",
		authDomain: "doculyze.firebaseapp.com",
		projectId: "doculyze",
		storageBucket: "doculyze.firebasestorage.app",
		messagingSenderId: "687971643996",
		appId: "1:687971643996:web:e070fa7fcc403a2dccac99",
		measurementId: "G-WQ2KQ9BMST"
	};
// My web app's client SDK Firebase configuration. Copied from the Firebase console. This should be moved to an environment variable in production for security purposes, but for the sake of simplicity, I'm hardcoding it here for now.
const firebaseConfig = config;

/** Initializing my Firebase app.
 * If there are no Firebase apps already initialized, initialize a new one with the provided configuration. If there is already an app initialized, use that one instead. This is to prevent the "Firebase app already exists" error that occurs when trying to initialize multiple apps with the same configuration.
 * If this lib file is executed multiple times, which hot reload might cause, this will ensure that only one Firebase app is initialized and used throughout the application.
 */
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

/** Returns the Auth instance for that Firebase app.
 * This will be used to handle all authentication-related operations in the app, such as signing in, signing out, and checking the current user's authentication state.
 * auth = {
	app: firebaseApp,
	currentUser: {
	uid: "abc123",
	email: "thomas@example.com",  
	displayName: "Thomas",  
	emailVerified: true,  
	providerData: [...]  
	},  
	languageCode: "...",  
	tenantId: null,  
	...  
	}

  */
const auth = getAuth(app);

function googleOAuth(app: FirebaseApp) {

}



export { auth };
