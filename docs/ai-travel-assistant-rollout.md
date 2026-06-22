# A2C Travel AI Assistant rollout

Tai lieu nay mo ta cach dau noi ban test AI tu van + dich thuat cho website du lich
A2C Travel. Repo hien tai chua co source web chinh, nen prototype duoc dat trong
`prototypes/ai-travel-assistant` de co the copy sang backend/web that sau.

## Muc tieu ban test

- Co chat widget de khach hoi ve tour, luu tru, am thuc va lich trinh.
- AI chi tra loi dua tren du lieu A2C dua vao context.
- Neu chua co gia/phong trong/lich khoi hanh, AI phai noi chua co thong tin xac nhan.
- Khi khach co nhu cau dat dich vu, AI moi de lai so dien thoai/Zalo.
- Co fallback de test khong can API key.

## Chay thu local

```bash
cp .env.example .env
npm run check:ai-travel
npm run start:ai-travel
```

Mo:

```txt
http://localhost:8787
```

Cau hoi test:

```txt
Toi di Quang Ngai 2 ngay nen di dau?
O Quang Ngai an gi ngon?
Co luu tru gan bien My Khe khong?
Tour Ly Son bao nhieu tien?
```

Neu chua cau hinh `OPENAI_API_KEY`, server se dung fallback tra loi dua tren file du
lieu mau.

## Cau hinh OpenAI API

Them vao `.env` hoac bien moi truong deploy:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AI_TRAVEL_PORT=8787
A2C_HOTLINE=so-hotline-that
A2C_ZALO_URL=https://zalo.me/so-zalo-that
```

Luu y: goi ChatGPT ca nhan khong thay the cho API key. Website can API key rieng de
backend goi model.

## Embed widget vao web

Khi server AI chay o domain rieng, vi du:

```txt
https://ai.a2ctravel.com
```

Chen script nay truoc the `</body>` cua website:

```html
<script
  src="https://ai.a2ctravel.com/widget.js"
  data-endpoint="https://ai.a2ctravel.com/api/ai-travel-chat"
  data-brand="A2C">
</script>
```

Ban dau co the chi gan o cac trang quan trong:

- Trang Quang Ngai: `/du-lich/quang-ngai`
- Trang tour Ly Son
- Trang luu tru
- Trang am thuc

## Dau noi du lieu that

File demo:

```txt
prototypes/ai-travel-assistant/data/a2c-travel-sample.json
```

Khi len web that, thay file JSON bang du lieu tu database hoac CMS:

| Nhom du lieu | Truong can co |
| --- | --- |
| Tour | ten, tinh, diem den, thoi luong, gia, lich trinh, bao gom, khong bao gom, link dat |
| Luu tru | ten, loai hinh, khu vuc, gia tu, tien ich, link dat |
| Am thuc | ten quan, khu vuc, mon noi bat, phu hop voi ai, link dat ban |
| Diem den | ten, tinh, mo ta, mua dep, thoi gian tham quan |
| Chinh sach | dat dich vu, huy/hoan, thanh toan, hotline, Zalo |

Nguyen tac quan trong:

```txt
Co du lieu xac nhan -> AI duoc tra loi.
Chua co du lieu xac nhan -> AI moi khach de lai lien he, khong tu bia.
```

## Endpoint hien co

### Chat

```http
POST /api/ai-travel-chat
Content-Type: application/json

{
  "message": "Toi di Quang Ngai 2 ngay nen di dau?"
}
```

Response:

```json
{
  "answer": "...",
  "provider": "fallback",
  "usedContext": "..."
}
```

### Luu lead

```http
POST /api/ai-travel-lead
Content-Type: application/json

{
  "name": "Nguyen Van A",
  "phone": "0900000000",
  "travelDate": "2026-07-10",
  "guests": 4,
  "need": "Tour Ly Son 2N1D"
}
```

Ban demo ghi lead vao:

```txt
prototypes/ai-travel-assistant/data/leads.jsonl
```

Khi len production, endpoint nay nen ghi vao CRM/database va gui thong bao cho nhan vien
qua email, Zalo OA hoac he thong admin.

## Lo trinh nang cap

1. Thay data JSON bang database/CMS that cua A2C.
2. Them form lead ngay trong widget.
3. Them admin page xem hoi thoai va lead.
4. Them dich thuat noi dung trong admin: Viet -> Anh/Han/Trung/Nhat.
5. Them vector search neu du lieu tour/luu tru/tin tuc lon.
6. Them thong ke: so cau hoi, ty le de lai so dien thoai, dich vu duoc hoi nhieu nhat.

## Checklist truoc khi public

- [ ] Da cau hinh `OPENAI_API_KEY` tren server, khong de lo ra frontend.
- [ ] Da thay hotline/Zalo mau bang thong tin that.
- [ ] Da thay data mau bang data that.
- [ ] Da them robots/security headers theo hosting production.
- [ ] Da gioi han rate limit de tranh bi spam API.
- [ ] Da them thong bao quyen rieng tu cho lead/sdt khach hang.
