/* 
   UI Utilities for LX Sync Server Management Console
   Standardizes notifications (Toasts) and Dialogs
   Requires: Tailwind CSS, FontAwesome
*/

(function () {
    // 1. Inject enhanced premium CSS
    const style = document.createElement('style');
    style.textContent = `
        @keyframes toast-in { from { transform: translateX(100%) scale(0.9); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
        @keyframes modal-in { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        
        .lx-toast-in { animation: toast-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .lx-modal-in { animation: modal-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .animate-marquee { display: inline-block; animation: marquee 10s linear infinite; }
        .pause-animation { animation-play-state: paused; }
        
        /* Premium Glassmorphism Overrides */
        .lx-glass {
            font-family: 'Outfit', sans-serif !important;
            background: rgba(255, 255, 255, 0.08) !important;
            backdrop-filter: blur(20px) saturate(180%) !important;
            -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37), inset 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
        }

        .lx-btn {
            font-family: 'Outfit', sans-serif !important;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        .lx-btn::after {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(rgba(255,255,255,0.1), transparent);
            opacity: 0; transition: opacity 0.2s;
        }
        .lx-btn:hover::after { opacity: 1; }
        .lx-btn:active { transform: scale(0.96); }

        .lx-input {
            background: rgba(0, 0, 0, 0.2) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            color: #fff !important;
            transition: border-color 0.3s, box-shadow 0.3s;
        }
        .lx-input:focus {
            border-color: rgba(16, 185, 129, 0.5) !important;
            box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1) !important;
        }
    `;
    document.head.appendChild(style);

    /**
     * Fresh Toast Notification (Pill Style)
     */
    function showToast(type, message, duration = 3000) {
        const config = {
            success: { gradient: 'from-emerald-400/90 to-teal-500/90', icon: 'fa-check-circle', shadow: 'shadow-emerald-500/20' },
            info: { gradient: 'from-blue-400/90 to-indigo-500/90', icon: 'fa-info-circle', shadow: 'shadow-blue-500/20' },
            error: { gradient: 'from-rose-400/90 to-red-500/90', icon: 'fa-exclamation-circle', shadow: 'shadow-rose-500/20' }
        };
        const conf = config[type] || config.info;

        const toast = document.createElement('div');
        toast.className = `toast-item fixed top-8 right-8 z-[2000] lx-toast-in`;

        toast.innerHTML = `
            <div class="lx-glass px-5 py-3.5 rounded-full flex items-center gap-4 min-w-[300px] max-w-[450px] ${conf.shadow}">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br ${conf.gradient} flex items-center justify-center text-white shadow-lg shrink-0">
                    <i class="fas ${conf.icon} text-lg"></i>
                </div>
                <div class="flex-1 overflow-hidden">
                    <div class="text-sm font-semibold text-white truncate px-1">${message}</div>
                </div>
                <button class="text-white/40 hover:text-white transition-colors ml-1 shrink-0">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>
        `;

        const gap = 16;
        let topBase = 32;

        document.body.appendChild(toast);

        // Position stack
        const toasts = document.querySelectorAll('.toast-item');
        toasts.forEach((el, idx) => {
            if (el === toast) return;
            const h = el.offsetHeight;
            const oldT = parseFloat(el.style.top || topBase);
            const newT = oldT + h + gap;
            el.style.top = `${newT}px`;
            el.dataset.offset = newT;
        });

        toast.style.top = `${topBase}px`;
        toast.dataset.offset = topBase;

        const removeToast = () => {
            toast.classList.replace('lx-toast-in', 'opacity-0');
            toast.style.transform = 'scale(0.9) translateX(20px)';
            setTimeout(() => {
                const currentOffset = parseFloat(toast.dataset.offset);
                const h = toast.offsetHeight + gap;
                toast.remove();
                document.querySelectorAll('.toast-item').forEach(el => {
                    const elT = parseFloat(el.style.top || 0);
                    if (elT > currentOffset) {
                        const newT = elT - h;
                        el.style.top = `${newT}px`;
                        el.dataset.offset = newT;
                    }
                });
            }, 400);
        };

        const timer = setTimeout(removeToast, duration);
        toast.querySelector('button').onclick = () => {
            clearTimeout(timer);
            removeToast();
        };
    }

    /**
     * Fresh Confirmation Modal (Clean & Modern)
     */
    function showSelect(title, message, options = {}) {
        const {
            confirmText = '确定',
            cancelText = '取消',
            danger = false
        } = options;

        const accentGradient = danger ? 'from-rose-400 to-red-500 shadow-rose-500/30' : 'from-emerald-400 to-teal-500 shadow-emerald-500/30';
        const icon = danger ? 'fa-exclamation-triangle' : 'fa-question-circle';
        const iconClass = danger ? 'text-rose-400' : 'text-emerald-400';

        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in";
            modal.innerHTML = `
                <div class="absolute inset-0 bg-black/40 backdrop-blur-[4px]"></div>
                <div class="lx-glass rounded-[28px] w-full max-w-sm overflow-hidden lx-modal-in relative shadow-2xl">
                    <div class="p-8">
                        <div class="flex flex-col items-center text-center gap-5">
                            <div class="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center ${iconClass} border border-white/10 mb-2">
                                <i class="fas ${icon} text-3xl"></i>
                            </div>
                            <div class="space-y-2">
                                <h3 class="text-xl font-bold text-white tracking-tight">${title}</h3>
                                <p class="text-sm text-white/60 leading-relaxed px-4">${message.replace(/\n/g, '<br>')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="p-5 flex gap-3">
                        <button id="confirm-cancel" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white bg-gradient-to-br ${accentGradient} rounded-2xl shadow-lg uppercase tracking-wider">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = (result) => {
                const content = modal.querySelector('.lx-modal-in');
                if (content) {
                    content.style.transform = 'scale(0.9) translateY(10px)';
                    content.style.opacity = '0';
                    modal.classList.add('opacity-0');
                }
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 300);
            };

            modal.querySelector('#confirm-ok').onclick = () => close(true);
            modal.querySelector('#confirm-cancel').onclick = () => close(false);
            if (modal.querySelector('#modal-close-x')) {
                modal.querySelector('#modal-close-x').onclick = () => close(false);
            }
        });
    }

    /**
     * Fresh Input Modal
     */
    function showInput(title, message, options = {}) {
        const {
            placeholder = '请输入内容...',
            defaultValue = '',
            confirmText = '确定',
            cancelText = '取消',
            inputType = 'text'
        } = options;

        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in";
            modal.innerHTML = `
                <div class="absolute inset-0 bg-black/40 backdrop-blur-[4px]"></div>
                <div class="lx-glass rounded-[28px] w-full max-w-sm overflow-hidden lx-modal-in relative shadow-2xl">
                    <div class="p-8">
                        <div class="flex flex-col items-center text-center gap-5">
                            <div class="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center text-emerald-400 border border-white/10">
                                <i class="fas fa-edit text-3xl"></i>
                            </div>
                            <div class="space-y-2 w-full text-center">
                                <h3 class="text-xl font-bold text-white tracking-tight">${title}</h3>
                                <p class="text-sm text-white/60 leading-relaxed mb-6">${message}</p>
                                <input type="${inputType}" id="modal-input" 
                                    class="lx-input w-full px-5 py-4 rounded-2xl outline-none text-base placeholder:text-white/20"
                                    placeholder="${placeholder}" value="${defaultValue}">
                            </div>
                        </div>
                    </div>
                    <div class="p-5 flex gap-3">
                        <button id="confirm-cancel" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="lx-btn flex-1 py-3.5 text-sm font-bold text-white bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30 rounded-2xl uppercase tracking-wider">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const input = modal.querySelector('#modal-input');
            input.focus();
            if (defaultValue) input.select();

            const close = (result) => {
                const content = modal.querySelector('.lx-modal-in');
                if (content) {
                    content.style.transform = 'scale(0.9) translateY(10px)';
                    content.style.opacity = '0';
                    modal.classList.add('opacity-0');
                }
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 300);
            };

            modal.querySelector('#confirm-ok').onclick = () => close(input.value);
            modal.querySelector('#confirm-cancel').onclick = () => close(null);

            input.onkeydown = (e) => {
                if (e.key === 'Enter') close(input.value);
                if (e.key === 'Escape') close(null);
            };
        });
    }

    /**
     * Marquee Helpers
     */
    function createMarqueeHtml(text, className = '') {
        return `<div class="truncate dynamic-marquee min-w-0 ${className}" data-text="${text.replace(/"/g, '&quot;')}">${text}</div>`;
    }

    function applyMarqueeChecks() {
        setTimeout(() => {
            const elements = document.querySelectorAll('.dynamic-marquee.truncate');
            elements.forEach(el => {
                if (el.scrollWidth > el.clientWidth) {
                    const text = el.getAttribute('data-text') || el.innerText;
                    const gap = '<span class="mx-8"></span>';
                    el.classList.remove('truncate');
                    el.classList.add('overflow-hidden');
                    const maskStyle = 'mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%); -webkit-mask-image: linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%);';
                    el.innerHTML = `
                    <div class="w-full relative" style="${maskStyle}">
                        <div class="inline-block whitespace-nowrap animate-marquee hover:pause-animation">
                            <span>${text}</span>${gap}<span>${text}</span>${gap}
                        </div>
                    </div>`;
                }
            });
        }, 50);
    }

    // Expose to global
    window.createMarqueeHtml = createMarqueeHtml;
    window.applyMarqueeChecks = applyMarqueeChecks;
    window.showToast = showToast;
    window.showSuccess = (msg) => showToast('success', msg, 2000);
    window.showInfo = (msg) => showToast('info', msg, 2000);
    window.showError = (msg) => showToast('error', msg, 3000);
    window.showSelect = showSelect;
    window.showInput = showInput;

    // Listen for resize
    window.addEventListener('resize', () => {
        clearTimeout(window._marqueeResizeTimer);
        window._marqueeResizeTimer = setTimeout(applyMarqueeChecks, 300);
    });

})();
