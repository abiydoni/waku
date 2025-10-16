# Menu Management System

## Overview

Sistem CRUD untuk mengelola tabel `tb_menu` dan `tb_botmenu` dengan layout 3 kolom sesuai permintaan.

## Features

### 1. Layout 3 Kolom

- **Kolom 1**: Master Menu (tb_menu) - Lebar 1 kolom
- **Kolom 2 & 3**: Bot Menu (tb_botmenu) - Lebar 2 kolom (digabung)

### 2. CRUD Operations untuk tb_menu

- ✅ **Create**: Tambah menu baru dengan name dan remark
- ✅ **Read**: Tampilkan semua menu dalam tabel
- ✅ **Update**: Edit menu yang sudah ada
- ✅ **Delete**: Hapus menu (dengan validasi jika masih digunakan)

### 3. CRUD Operations untuk tb_botmenu

- ✅ **Create**: Tambah bot menu dengan menu_id, parent_id, keyword, description, url
- ✅ **Read**: Tampilkan semua bot menu dalam tabel
- ✅ **Update**: Edit bot menu yang sudah ada
- ✅ **Delete**: Hapus bot menu (dengan validasi jika memiliki child)

### 4. Validasi Data

- ✅ Validasi foreign key (menu_id harus ada di tb_menu)
- ✅ Validasi parent_id (harus ada di tb_botmenu)
- ✅ Validasi cascade delete (tidak bisa hapus jika masih digunakan)
- ✅ Validasi required fields

### 5. UI/UX Features

- ✅ Responsive design dengan Tailwind CSS
- ✅ Modal forms untuk Create/Update
- ✅ SweetAlert2 untuk konfirmasi delete
- ✅ Filter dropdown untuk bot menu berdasarkan menu
- ✅ Real-time data refresh
- ✅ Loading states dan error handling

## File Structure

### Frontend

- `views/menu-management.ejs` - Halaman CRUD utama
- `views/dashboard.ejs` - Dashboard dengan link ke menu management

### Backend API Endpoints

- `GET /api/menus` - Ambil semua menu
- `POST /api/menus` - Buat menu baru
- `PUT /api/menus/:id` - Update menu
- `DELETE /api/menus/:id` - Hapus menu
- `GET /api/botmenus` - Ambil semua bot menu
- `POST /api/botmenus` - Buat bot menu baru
- `PUT /api/botmenus/:id` - Update bot menu
- `DELETE /api/botmenus/:id` - Hapus bot menu
- `GET /menu-management` - Halaman CRUD

## Database Schema

### tb_menu

```sql
CREATE TABLE `tb_menu` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `remark` varchar(200) NOT NULL,
  `time_stamp` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
);
```

### tb_botmenu

```sql
CREATE TABLE `tb_botmenu` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `menu_id` int(11) NOT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `keyword` varchar(10) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `url` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`)
);
```

## Usage

1. Akses dashboard di `http://localhost:4004/dashboard`
2. Klik tombol "Menu Management" di header
3. Kelola menu dan bot menu melalui interface yang tersedia

## Security

- ✅ Authentication required (requireAuth middleware)
- ✅ Input validation dan sanitization
- ✅ SQL injection protection dengan prepared statements
- ✅ CSRF protection melalui authentication token

## Error Handling

- ✅ Database connection errors
- ✅ Validation errors
- ✅ Foreign key constraint errors
- ✅ User-friendly error messages
