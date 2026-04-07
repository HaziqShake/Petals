import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hi.petals',
  appName: 'Petals',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['firebasestorage.googleapis.com', '*.googleapis.com', '*.firebaseapp.com']
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ["google.com"],
      // IMPORTANT: If you upload this to GitHub, MOVE this to an environment variable or secrets file!
      googleClientId: "486180695746-ne1nqvn1egq1qbkoil8nvsm1b5qvo0in.apps.googleusercontent.com",
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
