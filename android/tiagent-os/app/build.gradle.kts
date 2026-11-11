plugins {
    id("com.android.application")
}

android {
    namespace = "com.ajeitaai.tiagenteos"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ajeitaai.tiagenteos"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
