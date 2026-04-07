<div align="center">
  <h1 style="border: none; margin-bottom: 0;">🌸 Petals</h1>
  <p><em>A private, shared notebook for just the two of you.</em></p>
  <p>
    <img src="https://img.shields.io/badge/Platform-Android-f4a7b9?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore-orange?style=flat-square&logo=firebase" alt="Firebase" />
    <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="React" />
    <img src="https://img.shields.io/badge/Capacitor-8-119eff?style=flat-square&logo=capacitor" alt="Capacitor" />
  </p>
</div>

---

### What is Petals?

I built Petals because I wanted a space that recorded my story with my S/O

You create a room, share the invite code with your partner, and that's it. From there you have a shared notebook where you can leave notes for each other, pin photos like Polaroids on the page, and see when the other person is writing. It's simple on purpose.

### Features

- **Private by design**: Each room is locked to exactly two people via an invite code. No social features, no discovery, no ads.
- **Notebook-style editor**: Ruled lines, a margin, and spiral binding. The page zooms to fit your screen so it feels like writing on real paper.
- **Polaroid photos**: Photos land on the page as draggable, resizable objects. Tap once to select, then drag to reposition.
- **Real-time sync**: Notes sync instantly between both partners. You can see typing indicators and which note the other person has open.
- **Stickers**: 20+ built-in stickers, plus the ability to import your own.
- **Themes**: Choose between pink and blue. Each person picks their own and it syncs to their profile.

---

### Running locally

If you want to run this yourself, you'll need [Node.js](https://nodejs.org/) (v18+) and a [Firebase](https://firebase.google.com/) project with Authentication and Firestore enabled.

```bash
# Clone and install
git clone https://github.com/HaziqShake/Petals.git
cd YOUR_REPO/client
npm install

# Configure
cp .env.example .env
# Fill in your Firebase keys in .env

# Start the dev server
npm run dev
```

### Building the APK

```bash
npm run build
npx cap sync android
npx cap open android
# In Android Studio: Build → Build Bundle / APK → Build APK
```

Make sure `google-services.json` is in `android/app/` before building.

---

### Project structure

```
client/          React + Vite + TypeScript frontend
  src/
    components/  Polaroid, StickerCanvas, Lightbox, etc.
    hooks/       useAuth, useRoom, useNote, useUserRooms
    pages/       Auth, Notes, NoteEditor, Photos, Settings
    styles/      theme.css (full design system, CSS variables only)
    utils/       imageUtils, formatDate
shared/          TypeScript type definitions shared across client/server
firestore.rules  Production Firestore security rules
storage.rules    Storage rules (writes disabled, base64 pipeline)
```

### Some decisions I made (because I have a potato phone and am dirt poor)

- **No cloud storage for photos.** I compress images locally using Canvas and store them as base64 directly in Firestore. Firebase Storage is paid and was causing upload failures on Android, so I cut it out entirely. Everything stays on the free tier this way.
- **No animation libraries.** All transitions are plain CSS, kept under 200ms. I didn't want the overhead of Framer Motion or GSAP for what amounts to a few fades and slides.
- **No heavy dependencies.** No lodash, no moment.js. I tried to keep the bundle as small as I could.
- **Windowed rendering.** The notes list only renders what's visible on screen using IntersectionObserver, so it doesn't choke if you have a lot of notes.

---

<div align="center">
  <sub>Built for lovers.</sub>
</div>
