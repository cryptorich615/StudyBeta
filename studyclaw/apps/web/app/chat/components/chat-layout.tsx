import type { ReactNode } from 'react';

type ChatLayoutProps = {
  sidebar: ReactNode;
  header: ReactNode;
  thread: ReactNode;
  composer: ReactNode;
};

export default function ChatLayout({ sidebar, header, thread, composer }: ChatLayoutProps) {
  return (
    <section className="study-chat">
      <aside className="study-chat__sidebar">{sidebar}</aside>
      <div className="study-chat__main">
        {header}
        <div className="study-chat__thread-panel">{thread}</div>
        <div className="study-chat__composer-panel">{composer}</div>
      </div>
    </section>
  );
}
