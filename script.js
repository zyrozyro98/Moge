/* ==========================================================================
   DIPLOMALINE INTERACTIVE JAVASCRIPT ENGINE (script.js)
   Handles: Preloader, Sticky Nav, Mobile Menu, Counters, Calculator, WhatsApp Modal
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // 1. Premium Preloader Fade Out
    const loader = document.getElementById('loader');
    if (loader) {
        window.addEventListener('load', () => {
            // Adding a small delay for premium feels
            setTimeout(() => {
                loader.classList.add('fade-out');
                // Trigger stats counter check on load
                animateStatsOnScroll();
            }, 600);
        });
        
        // Fail-safe: if load event already fired or delayed
        setTimeout(() => {
            if (!loader.classList.contains('fade-out')) {
                loader.classList.add('fade-out');
            }
        }, 3000);
    }

    // 2. Sticky Navbar & Scroll-to-Top Button Visibility
    const header = document.querySelector('.main-header');
    const scrollTopBtn = document.getElementById('scrollTopBtn');
    
    window.addEventListener('scroll', () => {
        const scrollPos = window.scrollY;
        
        // Header sticky state
        if (scrollPos > 30) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        // Scroll to top button visibility
        if (scrollPos > 400) {
            scrollTopBtn.classList.add('show');
        } else {
            scrollTopBtn.classList.remove('show');
        }
        
        // Check for scroll and animate counters
        animateStatsOnScroll();
    });

    // 3. Scroll Smoothly to Top
    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // 4. Mobile Menu Navigation Toggle
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');
    
    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', () => {
            mobileToggle.classList.toggle('active');
            navMenu.classList.toggle('active');
        });

        // Close menu when clicking on a link
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileToggle.classList.remove('active');
                navMenu.classList.remove('active');
                
                // Add active state to clicked link
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            });
        });
    }

    // 5. Statistics Counters Count-Up Animation
    const statNumbers = document.querySelectorAll('.stat-number');
    let animatedStats = false;

    function animateStatsOnScroll() {
        if (animatedStats || statNumbers.length === 0) return;
        
        const firstStat = statNumbers[0];
        const rect = firstStat.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight && rect.bottom >= 0;
        
        if (isInViewport) {
            animatedStats = true;
            statNumbers.forEach(stat => {
                const target = parseInt(stat.getAttribute('data-target'), 10);
                const duration = 2000; // 2 seconds animation
                const stepTime = 30; // update speed
                const steps = duration / stepTime;
                const increment = target / steps;
                let current = 0;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        stat.textContent = target.toLocaleString('ar-EG'); // nice local digits format if needed
                        stat.textContent = target; // standard numerals but count-up
                        clearInterval(timer);
                    } else {
                        stat.textContent = Math.floor(current);
                    }
                }, stepTime);
            });
        }
    }

    // 6. Interactive Pricing / Subscription Calculator
    const uniOptions = document.querySelectorAll('.uni-option');
    const calcService = document.getElementById('calcService');
    const calcDuration = document.getElementById('calcDuration');
    const calculatedPrice = document.getElementById('calculatedPrice');
    const discountBadge = document.getElementById('discountBadge');
    const calcFeaturesList = document.getElementById('calcFeaturesList');
    const calcOrderBtn = document.getElementById('calcOrderBtn');
    
    let activeUniType = 'gov';
    let activeMultiplier = 1.0;

    // Feature descriptions mapping for pricing display updates
    const serviceFeaturesMap = {
        attendance: [
            "حضور كامل المحاضرات بنسبة 100% يومياً",
            "تحضير كامل ومشاركة فاعلة مع المحاضرين",
            "ملخصات دورية ومكتوبة لكل محاضرة تُحضر",
            "تغطية شعبة كاملة لمادة واحدة أو مادتين",
            "أمان كامل وسرية قصوى للأنظمة الإلكترونية"
        ],
        assignments: [
            "حل جميع الواجبات الأسبوعية والأنشطة",
            "حل الواجبات بطرق ذكية ونسب سرقة أدبية 0%",
            "تسليم الواجب قبل 24 ساعة على الأقل من موعده",
            "مراجعات وتعديلات مجانية متكررة",
            "كتابة تقارير وملخصات مواد احترافية"
        ],
        exams: [
            "حل الاختبارات النصفية (Midterms) كاملة",
            "حل الاختبارات النهائية (Finals) لضمان الدرجة",
            "تنسيق ومتابعة فورية مع كبار الخبراء",
            "حضور الاختبارات الدورية وتأكيد الحل الفل",
            "التعويض الذهبي في حالة عدم الحصول على ممتاز"
        ],
        research: [
            "إعداد أبحاث علمية محكمة ومتكاملة المصادر",
            "تنسيق الأبحاث حسب دليل جامعتك المعتمد",
            "تصميم مشاريع تخرج كاملة لجميع التخصصات",
            "برمجة مشاريع حاسوبية وكتابة الأكواد مع الشرح",
            "عروض تقديمية (PowerPoint) ممتازة للإلقاء"
        ],
        vip: [
            "حضور كامل المحاضرات بنسبة 100% لجميع المواد",
            "حل جميع الواجبات الأسبوعية والأنشطة طوال الترم",
            "حل الاختبارات النصفية والنهائية وتأكيد الدرجات",
            "إعداد البحوث والمشاريع المطلوبة كاملة",
            "مستشار أكاديمي خاص ومتابعة دورية عبر الواتساب",
            "أولوية قصوى ودعم متكامل VIP طوال 24 ساعة"
        ]
    };

    if (uniOptions.length > 0 && calcService && calcDuration && calculatedPrice) {
        
        // Handle University classification selection
        uniOptions.forEach(option => {
            option.addEventListener('click', () => {
                uniOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                
                activeUniType = option.getAttribute('data-uni-type');
                activeMultiplier = parseFloat(option.getAttribute('data-multiplier'));
                
                updateCalculator();
            });
        });

        // Handle Service selection changes
        calcService.addEventListener('change', updateCalculator);

        // Handle Duration slider changes
        calcDuration.addEventListener('input', () => {
            const val = calcDuration.value;
            const labels = document.querySelectorAll('.duration-labels span');
            labels.forEach((label, idx) => {
                if (idx + 1 == val) {
                    label.classList.add('active');
                } else {
                    label.classList.remove('active');
                }
            });
            updateCalculator();
        });

        // Live calculation logic
        function updateCalculator() {
            const selectedOpt = calcService.options[calcService.selectedIndex];
            const basePrice = parseFloat(selectedOpt.getAttribute('data-base-price'));
            const serviceKey = calcService.value;
            const durationMonths = parseInt(calcDuration.value, 10);
            
            // Calculate base cost
            let totalPrice = basePrice * activeMultiplier * durationMonths;
            
            // Apply multi-month discount
            let discountApplied = false;
            let discountRate = 0;
            if (durationMonths === 3) {
                discountRate = 0.10; // 10% discount for whole term (3 months)
                discountApplied = true;
            } else if (durationMonths === 4) {
                discountRate = 0.15; // 15% discount for extended term (4 months)
                discountApplied = true;
            }
            
            if (discountApplied) {
                totalPrice = totalPrice * (1 - discountRate);
                discountBadge.style.display = 'flex';
                discountBadge.innerHTML = `<i class="fa-solid fa-percent"></i> تم تطبيق خصم لفترة مطولة بنسبة ${discountRate * 100}%`;
            } else {
                discountBadge.style.display = 'none';
            }
            
            // Round pricing nicely
            const finalPrice = Math.round(totalPrice);
            calculatedPrice.textContent = finalPrice;
            
            // Update features list view
            calcFeaturesList.innerHTML = '';
            const features = serviceFeaturesMap[serviceKey] || [];
            features.forEach(feat => {
                const li = document.createElement('li');
                li.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${feat}`;
                calcFeaturesList.appendChild(li);
            });

            // Update WhatsApp pre-filled link
            const uniNameArabic = activeUniType === 'gov' ? 'جامعة حكومية' : (activeUniType === 'private' ? 'جامعة خاصة' : 'جامعة النخبة/دولية');
            const serviceNameArabic = selectedOpt.textContent.split(' (')[0];
            const durationText = durationMonths === 1 ? 'شهر واحد' : (durationMonths === 2 ? 'شهرين' : `${durationMonths} أشهر`);
            
            const waMessage = `مرحباً دبلومالاين، أود الاشتراك والاستفسار عن الخدمة التالية:\n` +
                              `- نوع الجامعة: ${uniNameArabic}\n` +
                              `- نوع الخدمة: ${serviceNameArabic}\n` +
                              `- مدة الاشتراك: ${durationText}\n` +
                              `- السعر التقديري بالحاسبة: ${finalPrice} ريال سعودي\n\n` +
                              `أرجو التواصل معي لتأكيد تفاصيل الاشتراك والبدء فوراً!`;
            
            calcOrderBtn.href = `https://wa.me/966541996435?text=${encodeURIComponent(waMessage)}`;
        }
        
        // Initial setup run
        updateCalculator();
    }

    // 7. Saudi University Registration Form Handler
    const uniRegForm = document.getElementById('uniRegForm');
    if (uniRegForm) {
        uniRegForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const name = document.getElementById('regName').value.trim();
            const phone = document.getElementById('regPhone').value.trim();
            const targetUni = document.getElementById('regUni').value;
            const desiredMajor = document.getElementById('regMajor').value.trim();
            
            const waMessage = `مرحباً منصة دبلومالاين، أود طلب خدمة "التسجيل والقبول الجامعي" في المملكة العربية السعودية. إليك تفاصيل طلبي:\n\n` +
                              `- اسم الطالب/الزبون: ${name}\n` +
                              `- رقم الواتساب للتواصل: ${phone}\n` +
                              `- الجامعة المستهدفة: ${targetUni}\n` +
                              `- التخصص الأكاديمي المرغوب: ${desiredMajor}\n\n` +
                              `أرجو من مستشار القبول والتسجيل التواصل معي وإفادتي بالإجراءات والمستندات المطلوبة في أسرع وقت. شكراً لكم!`;
            
            // Redirect the user directly to WhatsApp chat window
            const waUrl = `https://wa.me/966541996435?text=${encodeURIComponent(waMessage)}`;
            window.open(waUrl, '_blank');
        });
    }

    // 8. High-end FAQ Accordion Interaction
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            const answer = question.nextElementSibling;
            
            // Toggle active state on current item
            const isActive = item.classList.contains('active');
            
            // Close all items
            document.querySelectorAll('.faq-item').forEach(faqItem => {
                faqItem.classList.remove('active');
                faqItem.querySelector('.faq-answer').style.maxHeight = null;
            });
            
            // Open clicked item if it was closed
            if (!isActive) {
                item.classList.add('active');
                answer.style.maxHeight = answer.scrollHeight + 'px';
            }
        });
    });

    // 9. Floating WhatsApp Chat Widget Interaction
    const whatsappTrigger = document.getElementById('whatsappTrigger');
    const whatsappPopup = document.getElementById('whatsappPopup');
    const closePopup = document.getElementById('closePopup');
    
    if (whatsappTrigger && whatsappPopup) {
        // Toggle popup
        whatsappTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            whatsappPopup.classList.toggle('active');
            
            // Remove the unread notification badge once clicked
            const badge = whatsappTrigger.querySelector('.whatsapp-badge');
            if (badge) {
                badge.style.display = 'none';
            }
        });

        // Close via close button
        if (closePopup) {
            closePopup.addEventListener('click', (e) => {
                e.stopPropagation();
                whatsappPopup.classList.remove('active');
            });
        }

        // Close on clicking anywhere else on page
        document.addEventListener('click', (e) => {
            if (!whatsappPopup.contains(e.target) && e.target !== whatsappTrigger) {
                whatsappPopup.classList.remove('active');
            }
        });
    }

});
