plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
}
