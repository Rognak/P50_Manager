import { useLayoutEffect, useRef, useState } from 'react'

/** Иконка ⓘ с всплывающей подсказкой по наведению/клику.
 *  Подсказка сама уходит влево, если у правого края экрана не помещается. */
export function InfoHint({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!show || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    // ширина подсказки — w-72 (288px); не влезает справа → раскрываем влево
    setAlignRight(rect.left + 288 > window.innerWidth - 8)
  }, [show])

  return (
    <span ref={ref} className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          e.stopPropagation()
          setShow((v) => !v)
        }}
        className="cursor-help align-middle text-slate-500 hover:text-slate-300"
        aria-label="Подсказка"
      >
        ⓘ
      </button>
      {show && (
        <span
          className={
            'absolute top-full z-30 mt-1 block w-72 rounded-lg bg-bg-panel p-3 text-[11px] font-normal normal-case leading-relaxed text-slate-300 shadow-xl ring-1 ring-white/10 ' +
            (alignRight ? 'right-0' : 'left-0')
          }
        >
          {text}
        </span>
      )}
    </span>
  )
}
