import type { Metadata } from 'next';
import '@fontsource-variable/noto-sans-arabic';
import './globals.css';

export const metadata: Metadata = {
  title: 'Software Factory — من الفكرة إلى أول إصدار',
  description: 'مساحة عمل عربية لبناء البرمجيات، خطوة بخطوة. نسخة تأسيسية بسير عمل تجريبي واضح.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
