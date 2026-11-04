-- Unidade é a medida de venda (UN, M, CX). Número nesse campo foi digitado por
-- engano e saía ao lado da quantidade no PDF. O estoque não é alterado.
UPDATE `products` SET `unit` = 'UN' WHERE `unit` REGEXP '^[0-9., ]+$';
--> statement-breakpoint
UPDATE `quoteItems` SET `unit` = 'UN' WHERE `unit` REGEXP '^[0-9., ]+$';
