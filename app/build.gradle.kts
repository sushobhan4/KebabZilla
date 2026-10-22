import java.io.FileInputStream
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

val secretProps = Properties().apply {
    val secretFile = rootProject.file("secret.properties")
    val secretsFile = rootProject.file("secrets.properties")
    val localFile = rootProject.file("local.properties")

    if (secretFile.exists()) {
        load(FileInputStream(secretFile))
    } else if (secretsFile.exists()) {
        load(FileInputStream(secretsFile))
    } else if (localFile.exists()) {
        load(FileInputStream(localFile))
    }
}

fun getSecret(key: String, default: String = ""): String {
    return secretProps.getProperty(key)?.takeIf { it.isNotBlank() }
        ?: System.getenv(key)?.takeIf { it.isNotBlank() }
        ?: default
}

val googleMapsApiKey = getSecret("GOOGLE_MAPS_API_KEY")
val googleServerClientId = getSecret("GOOGLE_SERVER_CLIENT_ID")
val googleAndroidClientId = getSecret("GOOGLE_ANDROID_CLIENT_ID")

android {
    namespace = "com.kebabzilla"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.kebabzilla"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "GOOGLE_MAPS_API_KEY", "\"$googleMapsApiKey\"")
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", "\"$googleServerClientId\"")
        buildConfigField("String", "GOOGLE_ANDROID_CLIENT_ID", "\"$googleAndroidClientId\"")

        resValue("string", "google_maps_key", googleMapsApiKey)
        resValue("string", "google_server_client_id", googleServerClientId)
        resValue("string", "google_android_client_id", googleAndroidClientId)
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
        resValues = true
    }
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.core.ktx)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.recyclerview)
    implementation(libs.androidx.swiperefreshlayout)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.coil)
    implementation(libs.play.services.auth)
    implementation(libs.play.services.maps)
    implementation(libs.play.services.location)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
}
