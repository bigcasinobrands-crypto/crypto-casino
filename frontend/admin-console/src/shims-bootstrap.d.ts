declare module 'bootstrap' {
  export class Tooltip {
    constructor(element: HTMLElement, options?: Tooltip.Options)
    dispose(): void
    show(): void
    hide(): void
  }
  export namespace Tooltip {
    interface Options {
      title?: string
      placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right'
      trigger?: string
      container?: string | HTMLElement | false
      customClass?: string
    }
  }
}
