package app.gemiredmine.vault

import android.app.Activity
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// The API keys of the servers are encrypted with one data key. That key is kept wrapped, that is encrypted, by an
// Android Keystore key. The wrapping key needs the user's fingerprint or face when the setting asks for it, so the
// data key is unlocked once, and then every key of a server is read without asking again until the app ends.
//
// Preferences: "wrapped" holds the data key, wrapped; "biometric" says whether the wrapping key needs the user;
// "server:<id>" holds one API key, encrypted with the data key. A blob is the 12-byte IV followed by the ciphertext.

private const val PREFERENCES = "credential-vault"
private const val KEYSTORE = "AndroidKeyStore"
private const val PLAIN_KEY = "gemiredmine.vault.plain"
private const val BIOMETRIC_KEY = "gemiredmine.vault.biometric"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val TAG_BITS = 128
private const val IV_BYTES = 12
private const val WRAPPED = "wrapped"
private const val BIOMETRIC = "biometric"
private val SERVER_ID = Regex("^[A-Za-z0-9_-]{1,64}$")

private const val MISSING_ID = "The server is not known to the credential vault."
private const val INVALIDATED = "Your fingerprint or face changed, so the saved sign-ins were forgotten. Sign in again."
private const val UNREADABLE = "The saved sign-ins could not be read, so they were forgotten. Sign in again."

@InvokeArg
class ServerArgs {
    var serverId: String? = null
}

@InvokeArg
class SaveArgs {
    var serverId: String? = null
    var token: String? = null
}

@InvokeArg
class BiometricArgs {
    var enabled: Boolean = false
}

@TauriPlugin
class CredentialVaultPlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs by lazy { activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE) }

    // The data key, once it is unlocked. It lives in memory until the app ends. Every state change runs on the main
    // thread, which is also where the biometric prompt is shown.
    private var dataKey: SecretKey? = null
    private val waiting = mutableListOf<Pair<(SecretKey) -> Unit, (String) -> Unit>>()
    private var unlocking = false

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("available", canUseBiometrics())
        result.put("enabled", prefs.getBoolean(BIOMETRIC, false))
        invoke.resolve(result)
    }

    @Command
    fun save(invoke: Invoke) = onMainThread(invoke) {
        val args = invoke.parseArgs(SaveArgs::class.java)
        val serverId = validId(args.serverId)
        val token = args.token
        if (token.isNullOrEmpty() || token.length > 1024) return@onMainThread invoke.reject("The API key is empty or too long to keep.")
        withDataKey(
            onKey = { key ->
                prefs.edit().putString(entryName(serverId), seal(key, token.toByteArray(Charsets.UTF_8))).apply()
                invoke.resolve()
            },
            onError = { invoke.reject(it) },
        )
    }

    @Command
    fun load(invoke: Invoke) = onMainThread(invoke) {
        val serverId = validId(invoke.parseArgs(ServerArgs::class.java).serverId)
        val blob = prefs.getString(entryName(serverId), null)
        if (blob == null) {
            invoke.resolve(JSObject().put("token", JSONObject.NULL))
            return@onMainThread
        }
        withDataKey(
            onKey = { key ->
                val token = open(key, blob)
                if (token == null) invoke.reject(UNREADABLE) else invoke.resolve(JSObject().put("token", token))
            },
            onError = { invoke.reject(it) },
        )
    }

    /** Forgetting needs no unlock: it only removes the blob. */
    @Command
    fun remove(invoke: Invoke) = onMainThread(invoke) {
        val serverId = validId(invoke.parseArgs(ServerArgs::class.java).serverId)
        prefs.edit().remove(entryName(serverId)).apply()
        invoke.resolve()
    }

    /** Turns the fingerprint or face unlock on or off. The data key is re-wrapped, so the saved keys stay as they are. */
    @Command
    fun biometric(invoke: Invoke) = onMainThread(invoke) {
        val enabled = invoke.parseArgs(BiometricArgs::class.java).enabled
        if (enabled && !canUseBiometrics()) {
            return@onMainThread invoke.reject("Set up a fingerprint or face in the system settings first.")
        }
        if (enabled == prefs.getBoolean(BIOMETRIC, false) && prefs.contains(WRAPPED)) return@onMainThread invoke.resolve()
        withDataKey(
            onKey = { key -> wrap(key, enabled, onDone = { invoke.resolve() }, onError = { invoke.reject(it) }) },
            onError = { invoke.reject(it) },
        )
    }

    private fun onMainThread(invoke: Invoke, block: () -> Unit) {
        activity.runOnUiThread {
            try {
                block()
            } catch (error: Exception) {
                invoke.reject("The credential vault failed: ${error.message}")
            }
        }
    }

    private fun validId(id: String?): String {
        if (id == null || !SERVER_ID.matches(id)) throw IllegalArgumentException(MISSING_ID)
        return id
    }

    private fun entryName(serverId: String) = "server:$serverId"

    private fun canUseBiometrics(): Boolean =
        BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Calls onKey with the data key: the one in memory, or the one kept, unlocked now. Callers that come while an
     * unlock is in progress wait for it, so the user is asked once.
     */
    private fun withDataKey(onKey: (SecretKey) -> Unit, onError: (String) -> Unit) {
        dataKey?.let { return onKey(it) }
        waiting.add(onKey to onError)
        if (unlocking) return
        unlocking = true
        val finish = { message: String -> finishUnlock { it.second(message) } }
        try {
            unlock(
                onReady = { key ->
                    dataKey = key
                    finishUnlock { it.first(key) }
                },
                onError = finish,
            )
        } catch (error: Exception) {
            // A key that cannot be read must not leave the callers waiting: they are told why, and the next call tries again.
            finish("The saved sign-ins could not be unlocked: ${error.message}")
        }
    }

    private fun finishUnlock(each: (Pair<(SecretKey) -> Unit, (String) -> Unit>) -> Unit) {
        val callers = waiting.toList()
        waiting.clear()
        unlocking = false
        callers.forEach(each)
    }

    private fun unlock(onReady: (SecretKey) -> Unit, onError: (String) -> Unit) {
        val wrapped = prefs.getString(WRAPPED, null)
        val biometric = prefs.getBoolean(BIOMETRIC, false)
        if (wrapped == null) {
            // Nothing is kept yet, so a new data key is made and wrapped with the current setting.
            val key = newDataKey()
            wrap(key, biometric, onDone = { onReady(key) }, onError = onError)
            return
        }
        val blob = Base64.decode(wrapped, Base64.NO_WRAP)
        val iv = blob.copyOfRange(0, IV_BYTES)
        val body = blob.copyOfRange(IV_BYTES, blob.size)
        cipherFor(biometric, Cipher.DECRYPT_MODE, iv, onReady = { cipher ->
            val raw = try {
                cipher.doFinal(body)
            } catch (error: Exception) {
                // A key that does not open the data key came from another device, or the keys changed: start again.
                forgetAll()
                return@cipherFor onError(UNREADABLE)
            }
            onReady(SecretKeySpec(raw, "AES"))
        }, onError = onError)
    }

    /** Wraps the data key with the key of the setting, and keeps it with the setting. */
    private fun wrap(key: SecretKey, biometric: Boolean, onDone: () -> Unit, onError: (String) -> Unit) {
        cipherFor(biometric, Cipher.ENCRYPT_MODE, null, onReady = { cipher ->
            val wrapped = cipher.iv + cipher.doFinal(key.encoded)
            prefs.edit()
                .putString(WRAPPED, Base64.encodeToString(wrapped, Base64.NO_WRAP))
                .putBoolean(BIOMETRIC, biometric)
                .apply()
            onDone()
        }, onError = onError)
    }

    /**
     * A cipher for the wrapping key of one setting. With the biometric setting, the cipher is handed over only after the
     * user has authenticated for it.
     */
    private fun cipherFor(biometric: Boolean, mode: Int, iv: ByteArray?, onReady: (Cipher) -> Unit, onError: (String) -> Unit) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        try {
            val key = wrappingKey(biometric)
            if (mode == Cipher.DECRYPT_MODE) cipher.init(mode, key, GCMParameterSpec(TAG_BITS, requireNotNull(iv)))
            else cipher.init(mode, key)
        } catch (error: KeyPermanentlyInvalidatedException) {
            forgetAll()
            return onError(INVALIDATED)
        } catch (error: Exception) {
            return onError("The Android Keystore did not give the key: ${error.message}")
        }
        if (!biometric) return onReady(cipher)
        authenticate(cipher, onReady, onError)
    }

    private fun authenticate(cipher: Cipher, onReady: (Cipher) -> Unit, onError: (String) -> Unit) {
        val host = activity as? FragmentActivity ?: return onError("The app cannot show the fingerprint or face prompt.")
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val authenticated = result.cryptoObject?.cipher
                if (authenticated == null) onError("The fingerprint or face prompt gave no key.") else onReady(authenticated)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                onError("The unlock did not finish: $errString")
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock your saved sign-ins")
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        BiometricPrompt(host, ContextCompat.getMainExecutor(host), callback)
            .authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    /** The Keystore key of one setting, made on first use. It needs the user only with the biometric setting. */
    private fun wrappingKey(biometric: Boolean): SecretKey {
        val alias = if (biometric) BIOMETRIC_KEY else PLAIN_KEY
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
        if (biometric) {
            spec.setUserAuthenticationRequired(true)
            spec.setInvalidatedByBiometricEnrollment(true)
            // Every use needs a fresh authentication, so an unlock cannot be reused by something else later.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            }
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(spec.build())
        return generator.generateKey()
    }

    private fun newDataKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private fun seal(key: SecretKey, plain: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return Base64.encodeToString(cipher.iv + cipher.doFinal(plain), Base64.NO_WRAP)
    }

    /** The key read from a blob, or null when it does not open. */
    private fun open(key: SecretKey, blob: String): String? {
        val bytes = Base64.decode(blob, Base64.NO_WRAP)
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes.copyOfRange(0, IV_BYTES)))
            String(cipher.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size)), Charsets.UTF_8)
        } catch (error: Exception) {
            null
        }
    }

    /** Drops every kept key and the wrapping key of the fingerprint or face setting. */
    private fun forgetAll() {
        dataKey = null
        prefs.edit().clear().apply()
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        store.deleteEntry(BIOMETRIC_KEY)
    }
}
