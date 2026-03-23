import './globals.css';
import AppChrome from './components/app-chrome';
import { ThemeProvider } from './components/theme-provider';

export const metadata = {
    title: 'StudyClaw',
    description:
        'Low-stress academic companion that keeps overdue and upcoming priorities front and center.',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="app-shell font-sans">
                <ThemeProvider
                    attribute="class"
                    defaultTheme="light"
                    enableSystem
                    disableTransitionOnChange
                >
                    <AppChrome>{children}</AppChrome>
                </ThemeProvider>
            </body>
        </html>
    );
}
