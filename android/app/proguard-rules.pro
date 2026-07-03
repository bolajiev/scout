# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# react-native-bare-kit — ships NO consumer proguard rules. Its classes are
# resolved from native code via JNI; R8 stripping/renaming them crashes the
# app natively the moment the QVAC worklet starts (first model load).
-keep class to.holepunch.** { *; }
-keepclassmembers class to.holepunch.** { *; }

# JNI infrastructure used by RN + bare-kit
-keep class com.facebook.jni.** { *; }

# Add any project specific keep options here:
