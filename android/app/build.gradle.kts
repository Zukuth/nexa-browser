plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.nexabrowser.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nexabrowser.app"
        // 28 is a hard floor, not a preference: WebView.setDataDirectorySuffix()
        // (the whole basis of per-account process isolation) requires API 28+.
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    // WebViewCompat/WebViewFeature/ProxyController — the feature-detection and
    // isolation APIs this whole port hinges on all live in this artifact, not
    // in the platform android.webkit package directly.
    implementation("androidx.webkit:webkit:1.12.1")
    // Account list + per-account last-URL persistence (Fase 2), same role
    // store.js/data.json plays on desktop.
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    // Fase 3: periodic StevenBlack blocklist refresh that survives Doze,
    // instead of a process-lifetime timer Android would just kill.
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
