import type { Locale } from "@/lib/i18n";
import { SITE } from "./site-info";

// The wording of the privacy policy, terms of sale and returns policy, in both languages. Company
// details (ABN, address, phone, email) come from Settings and are added by legal-page.tsx.

export type LegalSection = { heading: string; paragraphs?: string[]; list?: string[] };
export type LegalDoc = { title: string; description: string; intro: string; sections: LegalSection[] };
export type LegalKey = "privacy" | "terms" | "returns";

/** Change this whenever the wording below changes. */
export const LEGAL_UPDATED: Record<Locale, string> = { en: "18 November 2026", zh: "2026年11月18日" };

export const LEGAL_PATH: Record<LegalKey, string> = { privacy: "/privacy", terms: "/terms", returns: "/returns" };

/** The wording the Australian Consumer Law sets for goods sold with these guarantees. */
export const ACL_GUARANTEE =
  "Our goods come with guarantees that cannot be excluded under the Australian Consumer Law. You are entitled to a replacement or refund for a major failure and compensation for any other reasonably foreseeable loss or damage. You are also entitled to have the goods repaired or replaced if the goods fail to be of acceptable quality and the failure does not amount to a major failure.";

const company = SITE.legalName;

export const LEGAL: Record<LegalKey, Record<Locale, LegalDoc>> = {
  privacy: {
    en: {
      title: "Privacy policy",
      description: "What personal information Foodpac Distribution collects, why, who it is shared with, and how to access or correct it.",
      intro: `${company} ("Foodpac", "we") supplies food packaging and kitchen supplies to businesses. This policy explains what personal information we collect, why we collect it, and how you can access or correct it. We handle personal information in line with the Australian Privacy Principles in the Privacy Act 1988 (Cth).`,
      sections: [
        {
          heading: "What we collect",
          list: [
            "Account details: business name, ABN, contact name, email, phone and address. Your password is stored only in a scrambled form that we can't read.",
            "Orders: what you buy and your prices, delivery addresses, recipient names and phone numbers, delivery instructions, invoices, payments, returns and store credit.",
            "Delivery records: the recipient's name, signature and delivery photos, and the time and place the driver confirmed the delivery.",
            "Enquiries: the name, business, email, phone, suburb and message you send us.",
            "Sales visits: notes and photos our sales staff record when they visit your business.",
            "Drivers: the van's location while a driver is sharing it on a delivery route.",
            "Website use: your IP address, to limit repeated sign-in and form attempts, and statistics about pages visited and how fast they load.",
          ],
          paragraphs: ["When you pay by card you enter your details on a secure page run by Stripe. We never see or keep your full card number."],
        },
        {
          heading: "Why we use it",
          list: [
            "To open and manage your account and show your prices.",
            "To take, deliver, invoice and collect payment for orders, and to let you follow your delivery.",
            "To keep proof of delivery and to handle returns, refunds and questions.",
            "To plan delivery routes and to improve our range, service and website.",
            "To protect our customers and systems, and to meet our legal, tax and accounting obligations.",
          ],
          paragraphs: [
            "We email you about your account, orders and deliveries. If reorder reminders are switched on, you can turn them off from your profile or from the link in any reminder.",
          ],
        },
        {
          heading: "Who we share it with",
          paragraphs: ["We don't sell personal information. We share it only with the services that help us run the business, or where the law requires it:"],
          list: [
            "Vercel: hosts the website and provides visit and page speed statistics.",
            "Supabase: hosts our database.",
            "Stripe: processes card payments.",
            "Resend and Zoho: send and receive our email.",
            "Google Maps Platform and OpenStreetMap: maps and address lookup.",
            "Vercel AI Gateway and the AI service it connects to: read photographed paper invoices so they can be entered as deliveries.",
            "GitHub: stores our encrypted nightly database backups, which are kept for 30 days.",
          ],
        },
        {
          heading: "Information sent overseas",
          paragraphs: [
            "Our website and database run in Sydney. Some of the services listed above are based in, or process information in, the United States and other countries, so your information may be sent there when they provide their service to us.",
          ],
        },
        {
          heading: "Cookies",
          paragraphs: ["We use only the cookies the website needs. We don't use advertising cookies, and our visit statistics don't use cookies."],
          list: [
            "dp_session keeps you signed in, for up to 7 days.",
            "lang remembers your language, for up to 1 year.",
            "shop-view remembers how you like products listed, for up to 1 year.",
            "theme remembers the back office's light or dark setting, for staff, for up to 1 year.",
          ],
        },
        {
          heading: "Keeping it safe",
          paragraphs: [
            "We use encrypted connections, limit access according to each person's role, and encrypt our backups. We keep personal information while your account is active and for as long as we need it for tax, accounting and legal purposes. After that we take reasonable steps to delete it or remove anything that identifies you.",
          ],
        },
        {
          heading: "Access and correction",
          paragraphs: [
            "You can update most of your details in your account. To ask for a copy of the personal information we hold about you, or to correct it, contact us using the details below. We'll respond within 30 days.",
          ],
        },
        {
          heading: "Questions and complaints",
          paragraphs: [
            "If you have a question or complaint about your privacy, contact us using the details below and we'll respond within 30 days. If you're not satisfied with our response, you can contact the Office of the Australian Information Commissioner at www.oaic.gov.au or on 1300 363 992.",
          ],
        },
        { heading: "Changes to this policy", paragraphs: ["We may update this policy from time to time. The latest version is always on this page."] },
      ],
    },
    zh: {
      title: "隐私政策",
      description: "Foodpac Distribution 收集哪些个人信息、用途、与谁共享,以及如何查阅或更正。",
      intro: `${company}(以下简称“Foodpac”或“我们”)为企业客户供应食品包装和厨房用品。本政策说明我们收集哪些个人信息、收集的原因,以及您如何查阅或更正这些信息。我们依照《1988 年隐私法》(联邦)中的澳大利亚隐私原则处理个人信息。`,
      sections: [
        {
          heading: "我们收集的信息",
          list: [
            "账户信息:企业名称、ABN、联系人姓名、电子邮箱、电话和地址。您的密码仅以我们无法读取的加密形式保存。",
            "订单信息:您购买的商品和价格、送货地址、收货人姓名和电话、送货说明、发票、付款、退货和店内余额。",
            "送货记录:收货人姓名、签名、送货照片,以及司机确认送达的时间和地点。",
            "咨询信息:您发送给我们的姓名、企业名称、电子邮箱、电话、所在区域和留言内容。",
            "销售拜访:我们的销售人员拜访贵公司时记录的备注和照片。",
            "司机信息:司机在配送路线上共享位置时的车辆位置。",
            "网站使用信息:用于限制重复登录和表单提交的 IP 地址,以及页面访问量和加载速度的统计数据。",
          ],
          paragraphs: ["使用银行卡付款时,您是在 Stripe 运营的安全页面上填写卡片信息。我们不会看到,也不会保存您的完整卡号。"],
        },
        {
          heading: "信息的用途",
          list: [
            "开设和管理您的账户,并显示您的价格。",
            "接收订单、安排配送、开具发票和收款,并让您跟踪配送进度。",
            "保存送达凭证,处理退货、退款和咨询。",
            "规划配送路线,改进我们的商品、服务和网站。",
            "保护客户和系统安全,并履行法律、税务和会计义务。",
          ],
          paragraphs: ["我们会通过电子邮件向您发送账户、订单和配送相关通知。如果开启了补货提醒,您可以在个人资料中或通过提醒邮件里的链接关闭。"],
        },
        {
          heading: "我们与谁共享信息",
          paragraphs: ["我们不会出售个人信息。我们只会与协助我们运营业务的服务商共享信息,或在法律要求时披露:"],
          list: [
            "Vercel:托管网站,并提供访问量和页面速度统计。",
            "Supabase:托管我们的数据库。",
            "Stripe:处理银行卡付款。",
            "Resend 和 Zoho:收发我们的电子邮件。",
            "Google Maps Platform 和 OpenStreetMap:提供地图和地址查询。",
            "Vercel AI Gateway 及其连接的 AI 服务:读取拍摄的纸质发票,以便录入为配送单。",
            "GitHub:存放我们每晚加密的数据库备份,备份保留 30 天。",
          ],
        },
        {
          heading: "向境外传输信息",
          paragraphs: ["我们的网站和数据库运行在悉尼。上述部分服务商位于美国或其他国家,或在这些国家处理信息,因此在向我们提供服务时,您的信息可能会被传输到这些地方。"],
        },
        {
          heading: "Cookie",
          paragraphs: ["我们只使用网站运行所必需的 Cookie,不使用广告 Cookie,访问统计也不使用 Cookie。"],
          list: [
            "dp_session:保持您的登录状态,最长 7 天。",
            "lang:记住您选择的语言,最长 1 年。",
            "shop-view:记住您喜欢的商品列表样式,最长 1 年。",
            "theme:为员工记住后台的浅色或深色设置,最长 1 年。",
          ],
        },
        {
          heading: "信息安全与保存",
          paragraphs: ["我们使用加密连接,按每个人的职责限制访问权限,并对备份进行加密。在您的账户有效期间,以及税务、会计和法律所需的期限内,我们会保存您的个人信息。此后,我们会采取合理措施将其删除或去除可识别身份的内容。"],
        },
        {
          heading: "查阅和更正",
          paragraphs: ["您可以在账户中更新大部分信息。如需获取我们持有的您的个人信息副本或进行更正,请通过下方联系方式与我们联系,我们会在 30 天内回复。"],
        },
        {
          heading: "咨询和投诉",
          paragraphs: ["如果您对隐私问题有疑问或投诉,请通过下方联系方式与我们联系,我们会在 30 天内回复。如果您对回复不满意,可以联系澳大利亚信息专员办公室(OAIC):www.oaic.gov.au 或致电 1300 363 992。"],
        },
        { heading: "政策更新", paragraphs: ["我们可能不时更新本政策,最新版本始终发布在本页面。"] },
      ],
    },
  },
  terms: {
    en: {
      title: "Terms of sale",
      description: "The terms that apply to orders with Foodpac Distribution: accounts, prices, delivery, payment and your legal rights.",
      intro: `These terms apply to every order you place with ${company} ("Foodpac", "we"), whether online, by phone, by email or through our sales team. We supply businesses, and by opening an account or placing an order you agree to these terms.`,
      sections: [
        {
          heading: "Your account",
          list: [
            "Accounts are for businesses. We may ask for details about your business, and we may approve or decline an application.",
            "Keep your details accurate and your password private. You're responsible for orders placed with your login.",
            "We may suspend an account that is misused or overdue.",
          ],
        },
        {
          heading: "Prices and GST",
          list: [
            "Prices are in Australian dollars, are set for your account, and exclude GST unless shown otherwise. GST is added where it applies and shown before you place your order.",
            "Prices can change. The price that applies is the one shown when you place your order.",
            "If a price is clearly wrong, we'll tell you before delivery and you can accept the correct price or cancel.",
          ],
        },
        {
          heading: "Orders",
          list: [
            "An order is accepted when we confirm it. All orders depend on stock being available.",
            "If we can't supply something, we'll tell you and you won't pay for what we can't supply.",
            "To change or cancel an order, contact us before it leaves for delivery.",
          ],
        },
        {
          heading: "Delivery",
          list: [
            "Delivery days, order cut-off times, fees and any minimum order are shown on our website and at checkout.",
            "Delivery dates and times are our best estimate. Please make sure someone can receive the goods, or give us clear delivery instructions.",
            "Our record of delivery, including any signature, photo, time and location, is evidence that the goods were delivered.",
            "Responsibility for the goods passes to you when they are delivered.",
          ],
        },
        {
          heading: "Payment",
          list: [
            "You can pay by the methods offered at checkout, which may include card and bank transfer.",
            "If we approve your account for payment on terms, each invoice is due within the agreed number of days from delivery, and a credit limit may apply.",
          ],
        },
        {
          heading: "Overdue accounts",
          list: [
            "The goods remain Foodpac's property until they have been paid for in full.",
            "If a payment is overdue, we may suspend your account and hold further deliveries until it is paid.",
          ],
        },
        { heading: "Returns", paragraphs: ["Our Returns and refunds policy explains how to report a problem with an order and how to return goods."] },
        {
          heading: "Your rights under the Australian Consumer Law",
          paragraphs: [
            ACL_GUARANTEE,
            "Nothing in these terms excludes rights you have under the Australian Consumer Law. Where the law allows, for goods not ordinarily bought for personal or household use, our liability for a failure to meet a guarantee is limited to replacing the goods, supplying equivalent goods, or paying the cost of doing so. To the extent the law allows, we aren't liable for indirect or consequential loss, including lost profits.",
          ],
        },
        {
          heading: "Product information",
          paragraphs: ["Product photos are a guide, and packaging can change. Please check that a product suits your intended use before you rely on it."],
        },
        { heading: "Changes to these terms", paragraphs: ["We may update these terms from time to time. The version on this page when you place an order applies to that order."] },
        { heading: "Governing law", paragraphs: ["These terms are governed by the laws of Queensland, Australia, and you agree to the jurisdiction of its courts."] },
      ],
    },
    zh: {
      title: "销售条款",
      description: "适用于 Foodpac Distribution 订单的条款:账户、价格、配送、付款以及您的法定权利。",
      intro: `无论您通过网站、电话、电子邮件还是我们的销售团队下单,本条款均适用于您向 ${company}(以下简称“Foodpac”或“我们”)提交的每一笔订单。我们的客户为企业。开设账户或提交订单,即表示您同意本条款。`,
      sections: [
        {
          heading: "您的账户",
          list: ["账户仅供企业使用。我们可能要求您提供企业相关信息,并有权批准或拒绝申请。", "请确保资料准确,并妥善保管密码。使用您的账号提交的订单由您负责。", "如账户被滥用或存在逾期款项,我们可以暂停该账户。"],
        },
        {
          heading: "价格和 GST",
          list: ["价格以澳元计算,按您的账户设定,除非另有说明,均不含 GST。适用的 GST 会在您提交订单前加上并显示。", "价格可能变动,以您提交订单时显示的价格为准。", "如果价格明显有误,我们会在送货前通知您,您可以接受正确价格或取消订单。"],
        },
        {
          heading: "订单",
          list: ["订单经我们确认后方为接受。所有订单均视库存情况而定。", "如果我们无法供应某项商品,会通知您,您无需为未供应的商品付款。", "如需更改或取消订单,请在货物发出前联系我们。"],
        },
        {
          heading: "配送",
          list: ["送货日、下单截止时间、运费和最低订单金额(如有)均显示在我们的网站和结账页面上。", "送货日期和时间为我们的最佳预估。请确保有人收货,或向我们提供清晰的送货说明。", "我们的送达记录(包括签名、照片、时间和地点)可作为货物已送达的证明。", "货物送达后,相关责任转移给您。"],
        },
        {
          heading: "付款",
          list: ["您可以使用结账时提供的付款方式,可能包括银行卡和银行转账。", "如果我们批准您的账户使用账期付款,每张发票应在送达后约定的天数内付清,并可能设有信用额度。"],
        },
        {
          heading: "逾期账户",
          list: ["在货款全部付清之前,货物的所有权仍归 Foodpac 所有。", "如有逾期款项,我们可以暂停您的账户并暂缓后续送货,直至款项付清。"],
        },
        { heading: "退货", paragraphs: ["我们的退换货政策说明了如何反馈订单问题以及如何退回商品。"] },
        {
          heading: "您在《澳大利亚消费者法》下的权利",
          paragraphs: [
            "我们的商品附带《澳大利亚消费者法》规定的不可排除的保障。如商品存在重大缺陷,您有权获得更换或退款,并就其他可合理预见的损失或损害获得赔偿。如商品未达到可接受的质量,但不构成重大缺陷,您也有权要求维修或更换。",
            "本条款不排除您依据《澳大利亚消费者法》享有的任何权利。在法律允许的范围内,对于通常不用于个人或家庭用途的商品,我们未能履行保障时的责任仅限于更换商品、提供同等商品或支付相应费用。在法律允许的范围内,我们不对间接或后果性损失(包括利润损失)承担责任。",
          ],
        },
        { heading: "商品信息", paragraphs: ["商品图片仅供参考,包装可能变动。使用前请确认商品适合您的用途。"] },
        { heading: "条款更新", paragraphs: ["我们可能不时更新本条款。您提交订单时本页面上的版本适用于该订单。"] },
        { heading: "适用法律", paragraphs: ["本条款受澳大利亚昆士兰州法律管辖,您同意接受该州法院的管辖。"] },
      ],
    },
  },
  returns: {
    en: {
      title: "Returns and refunds",
      description: "How to report a wrong, missing, damaged or faulty item and how to return goods to Foodpac Distribution.",
      intro: "Tell us within 48 hours of delivery if something is wrong, missing or damaged. If you've changed your mind, contact us within 7 days of delivery.",
      sections: [
        {
          heading: "Wrong, missing or damaged items",
          paragraphs: [
            "Please check your delivery when it arrives and tell us within 48 hours, with your order number and photos of any damage. This helps us check what happened and put it right quickly. We'll arrange the return of anything that needs to come back, at our cost. Telling us later doesn't take away your rights under the Australian Consumer Law.",
          ],
        },
        { heading: "Faulty goods", paragraphs: [ACL_GUARANTEE, "We'll cover the reasonable cost of returning faulty goods."] },
        {
          heading: "Change of mind",
          paragraphs: ["If you ordered the wrong item or no longer need it, we can accept a return when:"],
          list: [
            "you contact us within 7 days of delivery;",
            "the goods are unopened, in their original packaging and in a condition we can sell again; and",
            "you pay the cost of returning them.",
          ],
        },
        { heading: "Goods we can't take back for a change of mind", paragraphs: ["Frozen and chilled goods can't be returned for a change of mind, because we can't resell them safely once they've left our care."] },
        {
          heading: "How to return something",
          list: [
            "Contact us with your order number, the product, the quantity and the reason.",
            "Wait for us to confirm the return before sending anything back.",
            "We'll check the goods when they reach us and let you know the outcome.",
          ],
        },
        {
          heading: "Refunds, credit and exchanges",
          paragraphs: [
            "Once a return is approved, we'll refund you to the way you paid, add store credit to your account, or exchange the goods. Card refunds go back to the original card and can take several business days to appear.",
          ],
        },
        { heading: "Before delivery", paragraphs: ["To change or cancel an order that hasn't been delivered yet, contact us before it leaves for delivery."] },
      ],
    },
    zh: {
      title: "退换货政策",
      description: "如何反馈发错、缺少、损坏或有缺陷的商品,以及如何向 Foodpac Distribution 退货。",
      intro: "如果商品有误、缺少或损坏,请在送达后 48 小时内告诉我们。如果您改变主意,请在送达后 7 天内联系我们。",
      sections: [
        {
          heading: "发错、缺少或损坏的商品",
          paragraphs: ["收货时请检查商品,并在 48 小时内告诉我们您的订单号,如有损坏请附上照片。这有助于我们尽快核实并解决问题。需要退回的商品由我们安排并承担费用。逾期通知不会影响您在《澳大利亚消费者法》下的权利。"],
        },
        {
          heading: "有缺陷的商品",
          paragraphs: [
            "我们的商品附带《澳大利亚消费者法》规定的不可排除的保障。如商品存在重大缺陷,您有权获得更换或退款,并就其他可合理预见的损失或损害获得赔偿。如商品未达到可接受的质量,但不构成重大缺陷,您也有权要求维修或更换。",
            "退回有缺陷商品的合理费用由我们承担。",
          ],
        },
        {
          heading: "改变主意",
          paragraphs: ["如果您订错了商品或不再需要,在满足以下条件时我们可以接受退货:"],
          list: ["您在送达后 7 天内联系我们;", "商品未开封、保持原包装,并且可以再次销售;以及", "退回运费由您承担。"],
        },
        { heading: "不接受因改变主意退回的商品", paragraphs: ["冷冻和冷藏商品离开我们的保管后无法安全地再次销售,因此不接受因改变主意退货。"] },
        {
          heading: "如何退货",
          list: ["请联系我们,提供订单号、商品、数量和退货原因。", "请等我们确认退货后再寄回商品。", "我们收到商品后会进行检查,并告知您处理结果。"],
        },
        {
          heading: "退款、余额和换货",
          paragraphs: ["退货获批后,我们会按原付款方式退款、将余额存入您的账户,或为您换货。银行卡退款会退回原卡,可能需要几个工作日才能到账。"],
        },
        { heading: "送达之前", paragraphs: ["如需更改或取消尚未送达的订单,请在货物发出前联系我们。"] },
      ],
    },
  },
};
