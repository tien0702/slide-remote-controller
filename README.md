# Trình Chiếu Từ Xa

Web tĩnh để **chiếu slide trên laptop và điều khiển bằng điện thoại**. Kéo thả file PowerPoint (`.pptx`) là chiếu được ngay, ghi chú người thuyết trình được lấy tự động. Muốn hiển thị chính xác tuyệt đối thì thêm bản PDF.

- Laptop: hiện slide toàn màn hình và một mã QR.
- Điện thoại: quét mã là kết nối, có 5 tab:
  - **Điều khiển**: ghi chú, slide hiện tại và tiếp theo, nút Trước/Sau, vuốt để chuyển slide.
  - **Slide**: lưới ảnh thu nhỏ, chạm để nhảy đến slide bất kỳ.
  - **Ghi chú**: sửa ghi chú ngay trên điện thoại, xem tất cả, sao chép.
  - **Hẹn giờ**: đếm ngược theo thời lượng, báo nhanh/chậm so với tiến độ, rung khi còn 5 phút và khi hết giờ, thống kê thời gian từng slide.
  - **Công cụ**: bút laser, màn đen/trắng, hiện lại mã QR, về đầu/cuối, cài đặt (cỡ chữ, nền sáng, rung, vuốt, giữ màn hình sáng).
- Nhiều điện thoại có thể kết nối cùng lúc.

Laptop và điện thoại kết nối **trực tiếp với nhau** qua WebRTC. Slide và ghi chú không được tải lên máy chủ nào. Máy chủ công cộng của PeerJS chỉ dùng để hai máy tìm thấy nhau.

---

## 1. Đưa lên GitHub Pages (làm một lần)

1. Đăng nhập [github.com](https://github.com), bấm **New repository**.
   - Đặt tên, ví dụ `trinh-chieu`.
   - Chọn **Public** (tài khoản miễn phí chỉ bật được Pages cho repo public).
   - Bấm **Create repository**.
2. Trong repo vừa tạo, bấm **uploading an existing file**. Kéo thả **tất cả các file trong thư mục này** vào:
   - `index.html`, `app.js`, `app.css`, `notes.js`
   - `.nojekyll`, `README.md`

   Rồi bấm **Commit changes**.
   - File `.nojekyll` bắt đầu bằng dấu chấm nên có thể bị ẩn. Nếu không thấy, bỏ qua cũng được.
3. Vào **Settings › Pages**:
   - **Source**: chọn *Deploy from a branch*.
   - **Branch**: chọn `main`, thư mục `/ (root)`, bấm **Save**.
4. Đợi khoảng 1–2 phút, tải lại trang Settings › Pages. Địa chỉ web sẽ hiện ở đầu trang, dạng:
   `https://ten-cua-ban.github.io/trinh-chieu/`

Nếu dùng dòng lệnh:

```bash
cd trinh-chieu
git init && git add -A && git commit -m "Trình Chiếu Từ Xa"
git branch -M main
git remote add origin https://github.com/TEN-CUA-BAN/trinh-chieu.git
git push -u origin main
```

Sau đó bật Pages như bước 3.

## 2. Chuẩn bị bộ slide

Có hai cách:

- **Nhanh nhất: chỉ cần file PowerPoint (.pptx).**
  - Kéo thả file vào trang. Web tự hiển thị slide và lấy ghi chú.
  - Phông chữ, hiệu ứng chuyển cảnh và biểu đồ có thể khác đôi chút so với PowerPoint.
- **Chính xác nhất: file PDF + file .pptx của cùng bộ slide.**
  - Slide hiển thị từ PDF, đúng như bản gốc.
  - Ghi chú lấy từ .pptx.

| Phần mềm | PDF | PowerPoint |
|---|---|---|
| PowerPoint | File › Export › PDF | Dùng luôn file `.pptx` |
| Google Slides | Tệp › Tải xuống › PDF | Tệp › Tải xuống › Microsoft PowerPoint (.pptx) |
| Keynote | File › Export To › PDF | File › Export To › PowerPoint |
| Bộ slide trên Claude | Share › Export › PDF | Share › Export › PowerPoint |

File `.ppt` (định dạng cũ) và `.key` chưa đọc được: hãy lưu lại thành `.pptx` hoặc xuất PDF.

Ghi chú cũng có thể là file `.txt`, mỗi slide một đoạn, ngăn cách bằng một dòng chỉ có `---`:

```
Ghi chú slide 1

---

Ghi chú slide 2
```

Lưu ý:
- Slide ẩn trong PowerPoint được bỏ qua, để ghi chú khớp với slide đang chiếu.
- Nếu số slide của PowerPoint và số trang PDF khác nhau, web sẽ cảnh báo.

## 3. Trình chiếu

1. **Laptop:** mở địa chỉ GitHub Pages, kéo thả file `.pptx` (và PDF nếu có) vào bất kỳ đâu trên trang, rồi bấm **Bắt đầu trình chiếu**.
2. **Điện thoại:** quét mã QR trên màn chiếu bằng camera. Hoặc mở cùng địa chỉ, bấm “Nhập mã kết nối” và gõ mã 6 ký tự.
3. Khi điện thoại kết nối xong, mã QR tự ẩn. Bấm **Toàn màn hình** (hoặc phím `F`) trên laptop.

Phím tắt trên laptop:

| Phím | Tác dụng |
|---|---|
| `→` `↓` `Space` `PageDown` | Slide sau (bút trình chiếu cũng dùng được) |
| `←` `↑` `PageUp` | Slide trước |
| `Home` / `End` | Slide đầu / cuối |
| `F` | Toàn màn hình |
| `Q` | Hiện/ẩn mã QR |
| `B` / `W` | Màn đen / màn trắng |

Ghi chú sửa trên điện thoại được giữ trên laptop trong buổi chiếu. Muốn giữ lại thành file, bấm **Tải ghi chú** trên thanh điều khiển của laptop. Lần sau chọn file `.txt` đó làm ghi chú.

## 4. Mẹo để kết nối ổn định

- Tốt nhất laptop và điện thoại dùng **cùng một mạng Wi‑Fi**. Hoặc phát Wi‑Fi từ điện thoại cho laptop dùng.
- Một số mạng công ty hoặc hội trường chặn kết nối giữa các thiết bị. Nếu điện thoại báo “Chưa thấy màn chiếu” mãi, hãy chuyển cả hai máy sang Wi‑Fi phát từ điện thoại.
- Nếu tải lại trang trên laptop:
  - Mã kết nối vẫn giữ nguyên trong cùng tab.
  - Chọn lại file là điện thoại tự kết nối lại.
- Hãy chạy thử một lượt ở đúng địa điểm trước buổi diễn.

## Thành phần

- [pdf.js](https://mozilla.github.io/pdf.js/) để hiển thị PDF.
- [JSZip](https://stuk.github.io/jszip/) để đọc ghi chú trong file `.pptx`.
- [pptx-preview](https://www.npmjs.com/package/pptx-preview) để hiển thị trực tiếp file `.pptx`. Chỉ tải khi cần, miễn phí sử dụng.
- [PeerJS](https://peerjs.com/) để kết nối WebRTC.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) để tạo mã QR.

Tất cả tải từ CDN, nên web không cần bước build.
