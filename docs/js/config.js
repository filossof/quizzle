/* Quizzes live in Firebase (Firestore): everyone signs in with Google and sees only
   their own quizzes. Players on phones never sign in. These settings are public by
   design; the privacy comes from the rules in firestore.rules. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDJ3zumTbSC7load6wjOXisfre6UuyeC4w',
  authDomain: 'quizzle-a3132.firebaseapp.com',
  projectId: 'quizzle-a3132',
  storageBucket: 'quizzle-a3132.firebasestorage.app',
  messagingSenderId: '89417063490',
  appId: '1:89417063490:web:7b2ef5b95a0519f97161db',
};

const CONFIG = {
  peerPrefix: 'quizzle-v1-',
  // The old GitHub storage, used once to bring existing quizzes over to Firebase.
  legacy: { owner: 'filossof', repo: 'quizzle-data', branch: 'main' },
};

/* Address players open on their phones, e.g. https://filossof.github.io/quizzle/ */
const JOIN_URL = new URL('./', location.href).href;
