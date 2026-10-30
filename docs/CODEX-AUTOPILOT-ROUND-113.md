คุณคือ Codex ที่รับผิดชอบส่งมอบ NIPT-CBH v1.1.3 โดย Owner อนุมัติงาน Local Development แล้ว ขณะนี้คุณอยู่ใน Worktree v1.1.3 ที่มีงานยังไม่ได้ Commit จำนวนมาก ห้าม reset, clean, rebase หรือแก้ Worktree อื่น

อ่านไฟล์ docs/UPDATE-1.1.3-RELEASE-CHECKLIST.md, docs/CODEX-HANDOFF-UPDATE-1.1.3-20261030.md และ docs/CODEX-AUTONOMOUS-EXECUTION-113.md ก่อนลงมือ

จงทำงาน Local ที่ยังเป็น PARTIAL ต่อจริงให้มากที่สุดในรอบนี้ ไม่ใช่สรุปหรือวางแผนเฉย ๆ: Inspect -> Edit -> Run tests -> Fix -> Retest -> Update checklist with concrete evidence -> Continue next item. ให้ความสำคัญกับ P1 pg-boss/Retry/in-flight HIS/archive race, EQA all outbound, P0 native/browser, P2 PWA browser, P5 IQC mapping, P6 retention privileges, full native PostgreSQL/DB/contracts, Windows update-only rehearsal. ห้ามลดระดับการทดสอบ, ปิด test, เปลี่ยน FALSE เป็น PASS หรือแตะ hospital.

อย่าจบเพียงเพราะตรวจพบ FAIL หรือทำเพียง 1 ข้อ; แก้ไขและทดสอบซ้ำจนกว่าจะติดขอบเขตการทำงานของ Codex รอบนี้จริง ๆ. เมื่อจบแต่ละรอบ ให้แก้เอกสาร Checklist และ Resume ที่เป็นหลักฐานไว้ใน repo; ตัวเรียกอัตโนมัติจะเริ่มรอบใหม่เอง ไม่ต้องรายงานให้ Owner ส่งมาหา ChatGPT.

เมื่อ LOCAL release gates ทั้งหมดผ่านจริง (ยกเว้นโรงพยาบาล/UNC/production acceptance ที่ต้องอนุญาตแยก), ให้สร้าง docs/UPDATE-1.1.3-LOCAL-RELEASE-REPORT.md โดยบรรทัดแรกต้องเป็น '# LOCAL GO' และลงรายละเอียด exact tests, commits, SHA256 และ Windows rehearsal. ถ้าทำไม่ครบ ห้ามสร้างรายงาน LOCAL GO ปลอม. ห้าม push/deploy/install hospital; build EXE ได้ต่อเมื่อผลทดสอบ/rehearsal เป็นไปตาม release contract.

ดำเนินการแก้โค้ดและทดสอบเดี๋ยวนี้ ห้ามตอบด้วย NO-GO status แทนการทำงานที่ยังทำต่อได้.