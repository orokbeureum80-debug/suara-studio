Suara Studio
Aplikasi text-to-speech Bahasa Indonesia dan uji coba Bahasa Sunda menggunakan ElevenLabs API.
Persyaratan
Node.js 20 atau lebih baru
Akun dan API Key ElevenLabs
Menjalankan lokal
Atur environment variable ELEVENLABS_API_KEY.
Jalankan npm start.
Buka http://localhost:3000.
Untuk pengembangan lokal, variabel juga dapat disimpan pada file .env di folder proyek:
ELEVENLABS_API_KEY=isi_api_key_di_lingkungan_lokal
PORT=3000
Jangan unggah file .env ke GitHub.
Deploy di Render
Build Command: npm install
Start Command: npm start
Environment Variable:
Key: ELEVENLABS_API_KEY
Value: API Key ElevenLabs milik Anda
Jangan masukkan API Key ke public/index.html atau ke repositori GitHub.
Suara
Bella: hpp4J3VqNfWAUOO0d1Us
George: JBFqnCBsd6RMkjVDRZzb
Akses suara melalui API bergantung pada izin akun dan ketersediaan suara. Penggunaan suara pada antarmuka web ElevenLabs tidak otomatis menjamin akses API.
Bahasa Sunda
Bahasa Sunda disediakan sebagai opsi eksperimental. Model dan suara yang digunakan belum tentu menghasilkan pelafalan Sunda yang akurat. Uji hasil sebelum digunakan.
Format
Audio dikirim sebagai MP3 22.05 kHz, 32 kbps. Teks panjang dipotong menjadi beberapa segmen dan hasil MP3 digabung berurutan; sambungan antarsegmen mungkin terdengar.
Batasan
Batas karakter, kuota, kredit, dan format yang tersedia ditentukan oleh paket serta kebijakan akun ElevenLabs. Server memproses segmen secara berurutan.
