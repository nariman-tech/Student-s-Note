import { Link } from "react-router-dom";

// Политика конфиденциальности — открывается без входа (/privacy). Нужна Google для входа через Google
// и пользователям: что храним, где, зачем и как удалить. Русский + английский (для Google и портфолио).

const UPDATED = "8 октября 2026 / October 8, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="font-display font-700 text-lg mb-2">{title}</h2>
      <div className="text-sm leading-relaxed text-ink/80 space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="font-display font-800 text-lg">
            📓 Lectiva
          </Link>
          <a href="#english" className="text-sm text-ink/60 hover:text-ink">
            English ↓
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-display font-800 mb-1">Политика конфиденциальности</h1>
        <p className="text-xs text-ink/50 mb-8">Обновлено: {UPDATED}</p>

        <Section title="Что это за приложение">
          <p>
            Lectiva — учебный некоммерческий проект: конспекты, флеш-карты и группы для студентов. Здесь описано, какие данные
            приложение хранит, зачем и как их удалить.
          </p>
        </Section>

        <Section title="Какие данные мы храним">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Аккаунт:</b> почта, пароль (только в зашифрованном виде) или вход через Google — тогда от Google мы получаем
              только вашу почту и имя.
            </li>
            <li>
              <b>Профиль:</b> юзернейм, фото профиля (если загрузите), постоянный ID для поиска друзей.
            </li>
            <li>
              <b>То, что вы создаёте:</b> тетради и страницы конспектов, флеш-карты, сообщения и файлы в чатах групп,
              загруженные картинки и документы.
            </li>
            <li>
              <b>Друзья и группы:</b> заявки в друзья, участие в группах, кому вы открыли доступ к тетрадям.
            </li>
            <li>
              <b>Отзывы:</b> текст и оценка, а также страница приложения и тип браузера — чтобы разобраться с ошибкой.
            </li>
            <li>
              <b>Обезличенная статистика:</b> в какие дни вы заходили и сколько раз пользовались функциями (например, «скачать
              PDF»). Содержимое конспектов и сообщений в статистику не попадает.
            </li>
          </ul>
        </Section>

        <Section title="Зачем">
          <p>
            Только чтобы приложение работало: показывать ваши конспекты на любом устройстве, делиться ими с теми, кому вы
            разрешили, и улучшать приложение по отзывам и статистике. Мы <b>не продаём</b> данные, <b>не показываем рекламу</b>{" "}
            и не передаём данные третьим лицам, кроме сервисов хранения ниже.
          </p>
        </Section>

        <Section title="Где хранятся данные">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Supabase</b> — аккаунты, база данных (конспекты, сообщения, карточки).
            </li>
            <li>
              <b>Backblaze B2</b> (Европа) и <b>Cloudflare</b> — загруженные фото и файлы.
            </li>
            <li>
              <b>Vercel</b> — размещение самого сайта.
            </li>
          </ul>
          <p>
            Кто что видит, проверяется на стороне базы данных: ваши конспекты видите только вы и те, кому вы открыли доступ
            (друзья, участники группы или все, у кого есть ссылка — если вы её включили).
          </p>
        </Section>

        <Section title="Cookie и хранилище браузера">
          <p>
            Мы не используем рекламные cookie и сторонние счётчики. В браузере хранится только то, что нужно для работы:
            данные входа в аккаунт и пара настроек (например, когда в последний раз предлагали оставить отзыв).
          </p>
        </Section>

        <Section title="Ваши права и удаление данных">
          <p>
            Вы можете в любой момент удалить свои тетради, страницы, карточки, сообщения и файлы прямо в приложении, а тетради —
            скачать в PDF. Чтобы удалить аккаунт целиком со всеми данными, напишите через кнопку «💬 Отзыв» в приложении
            (тип «Другое») — мы удалим аккаунт в течение 30 дней.
          </p>
        </Section>

        <Section title="Дети">
          <p>Приложение рассчитано на студентов и старшеклассников. Если вам меньше 13 лет, пользуйтесь им вместе с родителями.</p>
        </Section>

        <Section title="Изменения">
          <p>Если политика изменится, мы обновим эту страницу и дату вверху.</p>
        </Section>

        <hr className="my-10 border-line" />

        <div id="english" className="scroll-mt-4">
          <h1 className="text-2xl font-display font-800 mb-1">Privacy Policy</h1>
          <p className="text-xs text-ink/50 mb-8">Last updated: October 8, 2026</p>

          <Section title="About">
            <p>
              Lectiva is a non-commercial student project for notes, flashcards and study groups. This page explains what data
              the app stores, why, and how to delete it.
            </p>
          </Section>
          <Section title="Data we store">
            <ul className="list-disc pl-5 space-y-1">
              <li>Account: email and password (stored hashed), or Google Sign-In — in that case we receive only your email and name.</li>
              <li>Profile: username, optional profile photo, a permanent ID used to find friends.</li>
              <li>Your content: notebooks and pages, flashcards, group chat messages and files, uploaded images and documents.</li>
              <li>Friends and groups: friend requests, group membership, who you shared notebooks with.</li>
              <li>Feedback: text and rating, plus the app page and browser type to help fix bugs.</li>
              <li>
                Aggregate usage statistics: on which days you were active and how often features were used. The content of your
                notes and messages is never included.
              </li>
            </ul>
          </Section>
          <Section title="Why">
            <p>
              Only to run the app: sync your notes across devices, share them with people you choose, and improve the app based
              on feedback. We <b>do not sell</b> data, <b>do not show ads</b>, and do not share data with third parties other than
              the hosting providers below.
            </p>
          </Section>
          <Section title="Where data is stored">
            <p>
              Supabase (accounts and database), Backblaze B2 (EU) and Cloudflare (uploaded files), Vercel (website hosting).
              Access rules are enforced in the database: your notes are visible only to you and to people you explicitly share
              them with.
            </p>
          </Section>
          <Section title="Cookies and browser storage">
            <p>No advertising cookies or third-party trackers. The browser stores only your sign-in session and a couple of settings.</p>
          </Section>
          <Section title="Your rights and deletion">
            <p>
              You can delete your notebooks, pages, flashcards, messages and files in the app at any time, and export notebooks to
              PDF. To delete your whole account and all its data, send a request via the «💬 Отзыв» (Feedback) button in the app —
              we will delete it within 30 days.
            </p>
          </Section>
          <Section title="Children">
            <p>The app is intended for university and high-school students. If you are under 13, please use it with a parent.</p>
          </Section>
          <Section title="Changes">
            <p>If this policy changes, we will update this page and the date above.</p>
          </Section>
        </div>
      </main>
    </div>
  );
}
