---
"open-rap-runtime": minor
---

The gaps of abaplint are fixed in Open RAP Runtime (D80): classic SQL writes of the saver are exact and `DELETE dbtab FROM @wa` deletes one row, `SUM`/`AVG`/`COUNT` can be declared inline, `SELECT … ENDSELECT` accepts a field list, `LOOP AT … FROM/TO` accepts `int8` bounds, and an enumerated object converted to text gives the name of its constant.
