import './styles.css';
import type { ReactNode } from 'react';
export const metadata={title:'주도주뉴스 어드민',description:'주도주뉴스 전용 관리 화면 개발 골격'};
export default function Layout({children}:{children:ReactNode}){return <html lang='ko'><body>{children}</body></html>;}
