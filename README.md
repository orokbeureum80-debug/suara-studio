# Suara Studio — Text to Speech Indonesia & Sunda

Aplikasi web untuk mengubah narasi Bahasa Indonesia atau Bahasa Sunda menjadi file audio WAV.

## Fitur

- Dropdown bahasa: Indonesia dan Sunda.
- Pilihan karakter suara pria/wanita yang tersedia pada Azure Speech.
- Vibe: natural, ceria, sedih, puitis, semangat, tenang, dan tegas.
- Kolom teks tanpa atribut `maxlength` atau penghitung batas input.
- Naskah panjang dipecah otomatis menjadi potongan kecil di server, disintesis berurutan, lalu digabung menjadi satu WAV.
- Pemutar audio dan tombol unduh WAV.
- API key hanya disimpan di server dalam file `.env`.
- Backend menggunakan Node.js bawaan, tanpa paket npm tambahan.

## Persyaratan

- Node.js 20 atau lebih baru.
- Resource Azure AI Speech yang aktif, beserta subscription key dan region.
- Koneksi internet.

## Menjalankan aplikasi

1. Ekstrak folder proyek.
2. Buka terminal di folder `suara-studio`.
3. Salin `.env.example` menjadi `.env`.
4. Isi nilai berikut pada `.env`:

   ```env
   AZURE_SPEECH_KEY=API_KEY_AZURE_SPEECH_ANDA
   AZURE_SPEECH_REGION=REGION_RESOURCE_ANDA
   PORT=3000
   ```

   Gunakan region yang tercantum pada resource Azure Speech Anda. Jangan menaruh API key di `public/index.html` atau membagikan file `.env`.

5. Jalankan server:

   ```bash
   npm start
   ```

   Tidak perlu menjalankan `npm install`, karena aplikasi hanya menggunakan modul bawaan Node.js.

6. Buka `http://localhost:3000` di browser. Jangan membuka `public/index.html` langsung dari file manager karena aplikasi memerlukan backend.

## Suara yang disediakan

**Bahasa Indonesia**
- Gadis — wanita (`id-ID-GadisNeural`)
- Ardi — pria (`id-ID-ArdiNeural`)
- Cahya — pria (`id-ID-Cahya:MAI-Voice-2-Flash`)
- Sari — wanita (`id-ID-Sari:MAI-Voice-2-Flash`)

**Bahasa Sunda**
- Jajang — pria (`su-ID-JajangNeural`)
- Tuti — wanita (`su-ID-TutiNeural`)

Ketersediaan voice bisa bergantung pada region, resource, dan perubahan katalog layanan provider.

## Catatan tentang “tanpa batas karakter”

Kolom teks pada UI tidak menetapkan batas karakter. Backend membagi teks menjadi bagian-bagian agar permintaan TTS tidak terlalu panjang, kemudian menggabungkan PCM menjadi satu file WAV. Namun, tidak ada layanan cloud yang benar-benar tanpa batas: ukuran permintaan (server ini membatasi body hingga 30 MB), durasi audio per panggilan, kuota, biaya, waktu proses, memori server, dan batas jaringan tetap berlaku. Teks sangat panjang membutuhkan lebih banyak waktu dan penggunaan kuota.

Vibe diterapkan dengan prosodi SSML (tempo, pitch, volume, dan jeda). Karena tidak semua voice menyediakan ekspresi emosi bawaan, hasilnya adalah pengarahan karakter penyampaian, bukan jaminan akting emosional seperti aktor manusia.

## Format audio

Server meminta PCM mentah 24 kHz, 16-bit, mono dari Azure Speech lalu membuat header WAV standar. Hasil unduhan berupa `.wav`.
