interface HelpProps {
  onBack: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function Help({ onBack }: HelpProps) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-semibold text-brand-600"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        Nazad
      </button>

      <div>
        <h2 className="text-base font-bold text-slate-900">Pomoć</h2>
        <p className="text-xs text-slate-500">Kratko uputstvo za korišćenje aplikacije.</p>
      </div>

      <Section title="Kako radi aplikacija">
        <p>
          Na karti se prikazuju prodavnice u vašem gradu. Dodirnete prodavnicu da vidite njene
          proizvode i opšte obaveštenje, a možete i da pretražujete proizvode po nazivu.
        </p>
      </Section>

      <Section title="Zašto je prodavnica „ugašena“">
        <p>
          Ikona prodavnice je siva (bleda) kada je prodavnica <strong>zatvorena</strong> ili kada
          trenutno <strong>nema nijedan proizvod</strong> za tekuću smenu. Čim dodate proizvod dok je
          prodavnica otvorena, ikona ponovo postaje narandžasta.
        </p>
      </Section>

      <Section title="Dodavanje i izmena proizvoda">
        <p>
          Otvorite <strong>Moji proizvodi</strong> pa <strong>Novi proizvod</strong>, ili izaberite
          postojeći i pritisnite <strong>Izmeni</strong>.
        </p>
        <Bullets
          items={[
            'Naziv je obavezan.',
            'Količina je opciona (ceo broj).',
            'Opis i slika su opcioni — sliku možete izabrati iz galerije ili uslikati kamerom.',
          ]}
        />
        <p>
          Proizvode je moguće dodavati i menjati <strong>samo dok je prodavnica otvorena</strong>. U
          suprotnom se prikazuje poruka da je prodavnica zatvorena.
        </p>
      </Section>

      <Section title="Opcije cene">
        <Bullets
          items={[
            <>
              <strong>Cena</strong> — prikazuje se jedna cena.
            </>,
            <>
              <strong>Sa popustom</strong> — stara cena je precrtana, a nova istaknuta.
            </>,
            <>
              <strong>Besplatno</strong> — proizvod je označen kao besplatan.
            </>,
            <>
              <strong>Bez cene</strong> — cena se uopšte ne prikazuje.
            </>,
          ]}
        />
      </Section>

      <Section title="Koliko dugo traje proizvod">
        <p>
          Proizvod se prikazuje tokom tekuće radne smene prodavnice („danas“). Kada smena, odnosno
          dan, istekne, proizvod sam nestaje sa glavne liste — <strong>ne briše se</strong> i ne
          morate ništa da radite.
        </p>
      </Section>

      <Section title="Ponovna objava (prethodna 2 dana)">
        <p>
          Proizvodi iz prethodna dva dana nalaze se u odeljku <strong>Prethodni dani (2 dana)</strong>.
          Pritisnite <strong>Reaktiviraj</strong> da proizvod ponovo objavite kao današnji. To je
          moguće dok je prodavnica otvorena. Posle oko tri dana proizvodi se trajno uklanjaju.
        </p>
      </Section>

      <Section title="Obaveštenje prodavnice">
        <p>
          Opšte obaveštenje je poruka cele prodavnice (npr. „Sveže pečivo od
          7h", akcija ili obaveštenje o neradnom danu). Otvarate ga u meniju podešavanja preko
          dugmeta <strong>Opšte obaveštenje</strong>.
        </p>
        <p>
          Sastoji se od <strong>teksta</strong> i <strong>slike</strong> (iz galerije ili kamere).
          Kada je aktivno, prikazuje se na karti kao kartica prodavnice i na vrhu liste proizvoda te
          prodavnice, iznad običnih proizvoda.
        </p>
        <p>Postoje dva režima rada:</p>
        <Bullets
          items={[
            <>
              <strong>Ručno</strong> — obaveštenje uključujete i isključujete dugmetom{' '}
              <strong>Aktiviraj</strong> / <strong>Deaktiviraj</strong>. Aktiviranje je moguće{' '}
              <strong>samo dok je prodavnica otvorena</strong>; deaktivacija je moguća u svakom
              trenutku. Obaveštenje se <strong>isključuje automatski na kraju smene</strong>, pa ga
              sledećeg radnog dana morate ponovo aktivirati.
            </>,
            <>
              <strong>Periodično</strong> — obaveštenje se samo prikazuje u zadatim terminima po
              danima nedelje. Za svaki dan podesite vreme početka i trajanje; termin mora biti{' '}
              <strong>u okviru radnog vremena prodavnice</strong> i ne može se zakazati na dan kada
              je prodavnica zatvorena.
            </>,
          ]}
        />
        <p>
          Tekst, slika i raspored mogu da se menjaju i dok je prodavnica zatvorena. Kada je
          obaveštenje aktivno, ono se računa kao sadržaj prodavnice, pa prodavnica sa aktivnim
          obaveštenjem nije prikazana kao „ugašena“ čak i kada nema proizvoda.
        </p>
      </Section>

      <Section title="Nalog i podrška">
        <p>
          U podešavanjima možete da promenite lozinku i da se odjavite. Za pomoć nam pišite na
          e-adresu navedenu ispod.
        </p>
      </Section>

      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
      >
        Nazad
      </button>
    </div>
  )
}

export default Help
