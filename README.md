# SFFD ShiftSwap

This repository contains the source code for **SFFD ShiftSwap**, a
shift‑trading application built for the San Francisco Fire
Department.  It is built on modern web technologies including
Next.js 15.1, React 19, Tailwind CSS 4.1 and Firebase.  The goal of
the project is to provide a simple, real‑time platform for
firefighters to post shifts they need covered and accept shifts from
their colleagues.

## Key technologies

* **Next.js 15.1** – Supports the App Router with React 19
  (stable).  New features such as `after()` and experimental
  `forbidden()`/`unauthorized()` APIs are available【426253857038578†L210-L247】.
* **Tailwind CSS 4.1** – Utility‑first styling with new
  utilities like text shadows and masks【893375231563547†L23-L47】.
* **Firebase v12** – Authentication, Firestore, Cloud Functions and
  messaging.
* **Capacitor 6** – Generates iOS and Android shells from the same
  codebase.
* **Vitest & Playwright** – Unit and end‑to‑end testing.

## Getting started

1. **Install dependencies**

   ```sh
   npm install
   ```

   The project uses exact versions as defined in `package.json` to
   ensure reproducible builds.

2. **Configure Firebase**

   Create a Firebase project and enable **Email/Password**
   authentication.  Copy the SDK credentials into a `.env.local`
   file based on `.env.example`:

   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```

3. **Run the development server**

   ```sh
   npm run dev
   ```

   The app will be available at `http://localhost:3000`.

4. **Initialize Firebase functions and hosting** (optional)

   Install the Firebase CLI and initialize functions/hosting.  The
   included `firebase.json` and `firestore.rules` provide a basic
   configuration.  To deploy hosting and functions run:

   ```sh
   firebase deploy --only hosting,functions
   ```

5. **Generate Capacitor shells**

   Install the Capacitor CLI globally (`npm i -g @capacitor/cli`) and
   initialise your app:

   ```sh
   npx cap init com.sffd.shiftswap "SFFD ShiftSwap" --web-dir=out
   npm run build
   npx cap copy ios
   npx cap copy android
   ```

   Then open the native projects with Xcode or Android Studio to
   build and deploy the iOS/Android apps.

## Project structure

```
app/            Next.js App Router pages and layouts
components/     Reusable UI components (navigation, shift cards, etc.)
lib/            Firebase initialisation and SFFD hierarchy
types/          TypeScript type definitions for users, shifts and trades
functions/      Firebase Cloud Functions written in TypeScript
public/         Static assets (empty by default)
``` 

## Continuous integration

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that installs dependencies, runs linting and tests, builds the app
and deploys it to Firebase Hosting using the
`FirebaseExtended/action-hosting-deploy@v0` action.  To activate
deployments, configure the following secrets in your GitHub
repository:

* **FIREBASE_SERVICE_ACCOUNT** – A JSON service account key with
  permissions to deploy hosting and functions.
* **PROJECT_ID** – Your Firebase project ID.

## Security considerations

* Only authenticated users may post shifts or accept trades.
* Firestore rules restrict read/write access to the appropriate
  documents (see `firestore.rules`).
* Environment variables should never be committed to source control.

## Roadmap

The current implementation provides a minimum viable product to
demonstrate shift posting, acceptance and profile management.  Future
enhancements may include:

* Advanced search and filtering for shifts (e.g. by station or
  battalion).
* Restricting shift acceptance based on rank and location.
* Push notifications using Firebase Cloud Messaging when trades are
  posted or accepted.
* Integrating third‑party calendar APIs for exporting shifts.
* Offline support and improved mobile experience via Capacitor.

Feel free to contribute by opening issues or submitting pull
requests.