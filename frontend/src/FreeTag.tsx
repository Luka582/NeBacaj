function FreeTag({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-green-100 font-bold text-green-600 ${
        large ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs'
      }`}
    >
      Besplatno!
    </span>
  )
}

export default FreeTag