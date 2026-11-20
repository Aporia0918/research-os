# 极限题常见错误：公开来源

测试「漏看条件」判断会不会误判时，用到的错因只取下面三份公开资料里写明的（用我们自己的话转述）。

| 错因 | 资料怎么说 | 来源 |
|---|---|---|
| 把不定式当成一个定值 | 列出 ∞−∞、∞/∞、0/0、0·∞、0⁰、1^∞、∞⁰ 都是不定式，提醒不能想当然认定它等于某个值 | Lamar 大学 Paul's Online Notes「Calculus Errors」 https://tutorial.math.lamar.edu/Extras/CommonErrors/CalculusErrors.aspx |
| 1/0 = ∞ 不看正负左右 | 指出 1/0=∞ 只是简写，左右极限可能是 +∞、−∞，双侧可能不存在 | 同上 |
| 0/0 说成 0 或「无定义/不存在」 | 记录学生把 0/0 写成 0、none、undefined，分不清「不定」和「无定义」 | Tonra 等，MERGA 2025，ERIC ED676455 https://files.eric.ed.gov/fulltext/ED676455.pdf |
| 不满足条件就用洛必达 | 强调用洛必达前必须先说明是 0/0 或 ∞/∞ 型 | 波特兰州立大学辅导中心「Common Errors in Algebra and Calculus」 https://www.pdx.edu/tutoring/sites/www.pdx.edu.tutoring/files/Common%20Errors%20in%20Algebra%20and%20Calculus.pdf |

落地成具体错答时的取值（`cfq/attribute.py` 的 FORM_GUESS）：0/0→0 和 0/0→不存在 来自论文里学生的原话；
∞/∞→1、∞−∞→0、0·∞→0、1^∞→1、0⁰→1、∞⁰→1、1/0→+∞ 是按「想当然」取的最常见值，资料本身没写具体数。
